type SystemNode = {
  systemId: number;
  regionId: number;
  position: { x: number; y: number; z: number };
  security?: number;
  adjacentSystems: number[];
};

type GraphData = {
  systems: Record<string, SystemNode>;
};

type AnsiblexBridge = { from: number; to: number; enabled?: boolean; bidirectional?: boolean };
type CynoBeacon = { id: number; enabled?: boolean };
type TravelSettings = {
  excludeZarzakh?: boolean;
  sameRegionOnly?: boolean;
  bridgeIntoDestination?: boolean;
  bridgeFromStaging?: boolean;
  bridgeCount?: number;
  bridgeContinuous?: boolean;
  bridgeOnlyChain?: boolean;
  allowAnsiblex?: boolean;
  ansiblexes?: AnsiblexBridge[];
  limitToCynoBeacons?: boolean;
  cynoBeacons?: CynoBeacon[];
  blacklistEnabled?: boolean;
  blacklist?: Array<{ id: number; enabled?: boolean }>;
};

type ComputeRequest = {
  type: 'compute';
  requestId: number;
  mode?: 'full' | 'pair-shard' | 'waypoint-segment';
  shardIndex?: number;
  shardCount?: number;
  segmentIndex?: number;
  segmentCount?: number;
  totalBridgeBudget?: number;
  destinationId: number;
  stagingId: number;
  waypointIds?: number[];
  bridgeRange: number;
  routesToShow: number;
  settings: TravelSettings;
};

type InitRequest = {
  type: 'init';
  graph: GraphData;
};

type BridgeLeg = {
  parkingId: number;
  endpointId: number;
  approachPath: number[];
  approachJumps: number;
  bridgeLy: number;
};

type RouteOption = {
  key: string;
  bridgeLegs: BridgeLeg[];
  postBridgePaths: number[][];
  postBridgeJumps: number;
  totalJumps: number;
  totalBridges: number;
  waypointIds?: number[];
};

type Candidate = {
  parkingId: number;
  endpointId: number;
  stagingJumps: number;
  destinationJumps: number;
  bridgeMeters: number;
  totalJumps: number;
};

type TwoBridgeCandidate = {
  parkingId: number;
  endpointId: number;
  parking2Id: number;
  endpoint2Id: number;
  stagingJumps: number;
  midTravelJumps: number;
  destinationJumps: number;
  bridgeMeters: number;
  bridge2Meters: number;
  totalJumps: number;
};

const LY = 9.4607e15;
const MAX_TRAVEL_JUMPS = 200;
const POCHVEN_REGION_ID = 10000070;
const DEV = !!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;

let graph: GraphData | null = null;
let systemsList: Array<{ id: number; x: number; y: number; z: number; regionId: number; security: number | null; adjacentSystems: number[] }> = [];
let travelTreeCache = new Map<string, { dist: Map<number, number>; prev: Map<number, number> }>();

type RouteProfile = {
  requestId: number;
  mode: string;
  phaseMs: Record<string, number>;
};

function createRouteProfile(payload: ComputeRequest): RouteProfile | null {
  if (!DEV) return null;
  const shard = payload.mode === 'pair-shard'
    ? ` shard ${payload.shardIndex ?? 0}/${payload.shardCount ?? 1}`
    : '';
  const segment = payload.mode === 'waypoint-segment'
    ? ` segment ${payload.segmentIndex ?? 0}/${payload.segmentCount ?? 1}`
    : '';
  return {
    requestId: payload.requestId,
    mode: `${payload.mode ?? 'full'}${shard}${segment}`,
    phaseMs: {},
  };
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function measureProfile<T>(profile: RouteProfile | null | undefined, phase: string, fn: () => T): T {
  if (!profile) return fn();
  const start = nowMs();
  try {
    return fn();
  } finally {
    profile.phaseMs[phase] = (profile.phaseMs[phase] || 0) + nowMs() - start;
  }
}

function logProfile(profile: RouteProfile | null | undefined) {
  if (!profile) return;
  const rounded = Object.fromEntries(
    Object.entries(profile.phaseMs).map(([phase, ms]) => [phase, Number(ms.toFixed(1))])
  );
  console.debug('[BridgePlannerWorker]', `request ${profile.requestId}`, profile.mode, rounded);
}

function isForbiddenSystem(node: { regionId: number; security?: number | null }) {
  const sec = typeof node.security === 'number' ? node.security : null;
  return node.regionId === POCHVEN_REGION_ID || (sec != null && sec >= 0.5);
}

function buildSystemsList(data: GraphData) {
  const list: Array<{ id: number; x: number; y: number; z: number; regionId: number; security: number | null; adjacentSystems: number[] }> = [];
  for (const [idStr, sys] of Object.entries(data.systems)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    list.push({
      id,
      x: sys.position.x,
      y: sys.position.y,
      z: sys.position.z,
      regionId: sys.regionId,
      security: Number.isFinite(sys.security) ? Number(sys.security) : null,
      adjacentSystems: sys.adjacentSystems || [],
    });
  }
  systemsList = list;
}

function buildAnsiMap(settings: TravelSettings) {
  const ansiFrom: Map<number, number[]> = new Map();
  if (settings.allowAnsiblex && settings.ansiblexes?.length) {
    for (const b of settings.ansiblexes) {
      if (!b || b.enabled === false) continue;
      const from = Number(b.from);
      const to = Number(b.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      if (!ansiFrom.has(from)) ansiFrom.set(from, []);
      ansiFrom.get(from)!.push(to);
      if (b.bidirectional !== false) {
        if (!ansiFrom.has(to)) ansiFrom.set(to, []);
        ansiFrom.get(to)!.push(from);
      }
    }
  }
  return ansiFrom;
}

function buildBlacklistSet(settings: TravelSettings) {
  const set = new Set<number>();
  if (!settings.blacklistEnabled || !settings.blacklist?.length) return set;
  for (const entry of settings.blacklist) {
    if (!entry || entry.enabled === false) continue;
    const id = Number(entry.id);
    if (!Number.isFinite(id)) continue;
    set.add(id);
  }
  return set;
}

function stableNumericList(values: number[]) {
  return values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function buildTravelSettingsHash(settings: TravelSettings) {
  const ansiblexes = settings.allowAnsiblex
    ? (settings.ansiblexes || [])
      .filter((bridge) => bridge && bridge.enabled !== false && Number.isFinite(Number(bridge.from)) && Number.isFinite(Number(bridge.to)))
      .map((bridge) => ({
        from: Number(bridge.from),
        to: Number(bridge.to),
        bidirectional: bridge.bidirectional !== false,
      }))
      .sort((a, b) => a.from - b.from || a.to - b.to || Number(a.bidirectional) - Number(b.bidirectional))
    : [];
  const blacklist = settings.blacklistEnabled
    ? stableNumericList((settings.blacklist || [])
      .filter((entry) => entry && entry.enabled !== false)
      .map((entry) => Number(entry.id)))
    : [];
  return JSON.stringify({
    excludeZarzakh: !!settings.excludeZarzakh,
    sameRegionOnly: !!settings.sameRegionOnly,
    allowAnsiblex: !!settings.allowAnsiblex,
    ansiblexes,
    blacklistEnabled: !!settings.blacklistEnabled,
    blacklist,
  });
}

function buildCynoBeaconSet(settings: TravelSettings) {
  const set = new Set<number>();
  if (!settings.cynoBeacons?.length) return set;
  for (const entry of settings.cynoBeacons) {
    if (!entry || entry.enabled === false) continue;
    const id = Number(entry.id);
    if (!Number.isFinite(id)) continue;
    set.add(id);
  }
  return set;
}

function computeTravelTreeUncached(startId: number, settings: TravelSettings, maxJumps: number) {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  if (!graph) return { dist, prev };
  const systems = graph.systems;
  const start = systems[String(startId)];
  if (!start) return { dist, prev };

  const exclude = new Set<number>();
  if (settings.excludeZarzakh) exclude.add(30100000);
  const blacklist = buildBlacklistSet(settings);
  const sameRegionOnly = !!settings.sameRegionOnly;
  const startRegion = start.regionId;

  const ansiFrom = buildAnsiMap(settings);

  dist.set(startId, 0);
  const queue: number[] = [startId];

  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const d = dist.get(id);
    if (d == null) continue;
    if (d >= maxJumps) continue;
    const node = systems[String(id)];
    if (!node) continue;
    if (exclude.has(id) || blacklist.has(id)) continue;
    if (sameRegionOnly && node.regionId !== startRegion) continue;

    for (const next of node.adjacentSystems) {
      if (exclude.has(next) || blacklist.has(next)) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        prev.set(next, id);
        queue.push(next);
      }
    }

    if (settings.allowAnsiblex) {
      const outs = ansiFrom.get(id) || [];
      for (const next of outs) {
        if (exclude.has(next) || blacklist.has(next)) continue;
        const nextNode = systems[String(next)];
        if (!nextNode) continue;
        if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
        if (!dist.has(next)) {
          dist.set(next, d + 1);
          prev.set(next, id);
          queue.push(next);
        }
      }
    }
  }

  return { dist, prev };
}

function computeTravelTree(startId: number, settings: TravelSettings, maxJumps: number) {
  const cacheKey = `${startId}:${maxJumps}:${buildTravelSettingsHash(settings)}`;
  const cached = travelTreeCache.get(cacheKey);
  if (cached) return cached;
  const result = computeTravelTreeUncached(startId, settings, maxJumps);
  travelTreeCache.set(cacheKey, result);
  return result;
}

function buildPath(prev: Map<number, number>, startId: number, endId: number): number[] | null {
  const path: number[] = [];
  let cur: number | undefined = endId;
  while (cur != null) {
    path.push(cur);
    if (cur === startId) break;
    cur = prev.get(cur);
    if (cur == null) return null;
  }
  return path.reverse();
}

type HeapItem = { id: number; cost: number };

class MinHeap {
  private data: HeapItem[] = [];
  push(item: HeapItem) {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }
  pop(): HeapItem | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }
  get size() {
    return this.data.length;
  }
  private bubbleUp(idx: number) {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.data[parent].cost <= this.data[idx].cost) break;
      [this.data[parent], this.data[idx]] = [this.data[idx], this.data[parent]];
      idx = parent;
    }
  }
  private bubbleDown(idx: number) {
    const len = this.data.length;
    while (true) {
      let smallest = idx;
      const left = idx * 2 + 1;
      const right = idx * 2 + 2;
      if (left < len && this.data[left].cost < this.data[smallest].cost) smallest = left;
      if (right < len && this.data[right].cost < this.data[smallest].cost) smallest = right;
      if (smallest === idx) break;
      [this.data[smallest], this.data[idx]] = [this.data[idx], this.data[smallest]];
      idx = smallest;
    }
  }
}

function buildPathToSource(prev: Map<number, number>, startId: number, sourceId: number): number[] | null {
  const path: number[] = [];
  let cur: number | undefined = startId;
  while (cur != null) {
    path.push(cur);
    if (cur === sourceId) break;
    cur = prev.get(cur);
    if (cur == null) return null;
  }
  return path;
}

function pathHasBlacklist(path: number[], blacklist: Set<number>) {
  for (const id of path) {
    if (blacklist.has(id)) return true;
  }
  return false;
}

function compareOneBridgeCandidates(a: Candidate, b: Candidate) {
  if (a.totalJumps !== b.totalJumps) return a.totalJumps - b.totalJumps;
  if (a.stagingJumps !== b.stagingJumps) return a.stagingJumps - b.stagingJumps;
  if (a.destinationJumps !== b.destinationJumps) return a.destinationJumps - b.destinationJumps;
  return a.bridgeMeters - b.bridgeMeters;
}

function compareTwoBridgeCandidates(a: TwoBridgeCandidate, b: TwoBridgeCandidate) {
  if (a.totalJumps !== b.totalJumps) return a.totalJumps - b.totalJumps;
  if (a.stagingJumps !== b.stagingJumps) return a.stagingJumps - b.stagingJumps;
  if (a.midTravelJumps !== b.midTravelJumps) return a.midTravelJumps - b.midTravelJumps;
  if (a.destinationJumps !== b.destinationJumps) return a.destinationJumps - b.destinationJumps;
  if (a.bridgeMeters !== b.bridgeMeters) return a.bridgeMeters - b.bridgeMeters;
  return a.bridge2Meters - b.bridge2Meters;
}

function insertCandidate<T>(best: T[], cand: T, limit: number, compare: (a: T, b: T) => number) {
  const idx = best.findIndex((b) => compare(cand, b) < 0);
  if (idx === -1) {
    if (best.length < limit) {
      best.push(cand);
      return true;
    }
    return false;
  }
  best.splice(idx, 0, cand);
  if (best.length > limit) best.pop();
  return true;
}

function buildRoutesFromCandidates(
  candidates: Candidate[],
  stagingPrev: Map<number, number>,
  destinationPrev: Map<number, number>,
  stagingId: number,
  destinationId: number,
  blacklist?: Set<number>
): RouteOption[] {
  const routes: RouteOption[] = [];
  for (const c of candidates) {
    const travelPath = buildPath(stagingPrev, stagingId, c.parkingId);
    const destinationPath = buildPath(destinationPrev, destinationId, c.endpointId);
    if (!travelPath || !destinationPath) continue;
    if (blacklist && (pathHasBlacklist(travelPath, blacklist) || pathHasBlacklist(destinationPath, blacklist))) continue;
    routes.push({
      key: `${c.parkingId}-${c.endpointId}`,
      bridgeLegs: [{
        parkingId: c.parkingId,
        endpointId: c.endpointId,
        approachPath: travelPath,
        approachJumps: c.stagingJumps,
        bridgeLy: c.bridgeMeters / LY,
      }],
      postBridgePaths: [destinationPath.slice().reverse()],
      postBridgeJumps: c.destinationJumps,
      totalJumps: c.totalJumps,
      totalBridges: 1,
    });
  }
  return routes;
}

function buildRoutesFromTwoBridgeCandidates(
  candidates: TwoBridgeCandidate[],
  stagingPrev: Map<number, number>,
  destinationPrev: Map<number, number>,
  midPrev: Map<number, number>,
  stagingId: number,
  destinationId: number,
  blacklist?: Set<number>
): RouteOption[] {
  const routes: RouteOption[] = [];
  for (const c of candidates) {
    const travelPath = buildPath(stagingPrev, stagingId, c.parkingId);
    const midPath = buildPathToSource(midPrev, c.endpointId, c.parking2Id);
    const destinationPath = buildPath(destinationPrev, destinationId, c.endpoint2Id);
    if (!travelPath || !midPath || !destinationPath) continue;
    if (blacklist && (pathHasBlacklist(travelPath, blacklist) || pathHasBlacklist(midPath, blacklist) || pathHasBlacklist(destinationPath, blacklist))) continue;
    routes.push({
      key: `${c.parkingId}-${c.endpointId}-${c.parking2Id}-${c.endpoint2Id}`,
      bridgeLegs: [
        {
          parkingId: c.parkingId,
          endpointId: c.endpointId,
          approachPath: travelPath,
          approachJumps: c.stagingJumps,
          bridgeLy: c.bridgeMeters / LY,
        },
        {
          parkingId: c.parking2Id,
          endpointId: c.endpoint2Id,
          approachPath: midPath,
          approachJumps: c.midTravelJumps,
          bridgeLy: c.bridge2Meters / LY,
        },
      ],
      postBridgePaths: [destinationPath.slice().reverse()],
      postBridgeJumps: c.destinationJumps,
      totalJumps: c.totalJumps,
      totalBridges: 2,
    });
  }
  return routes;
}

function isExcludedSystem(id: number, settings: TravelSettings, blacklist: Set<number>) {
  if (settings.excludeZarzakh && id === 30100000) return true;
  if (blacklist.has(id)) return true;
  return false;
}

function isValidBridgeLandingSystem(
  system: { id: number; regionId: number; security: number | null },
  settings: TravelSettings,
  blacklist: Set<number>,
  activeCynoBeacons: Set<number>,
  limitToCynoBeacons: boolean
) {
  if (isExcludedSystem(system.id, settings, blacklist)) return false;
  if (isForbiddenSystem(system)) return false;
  if (limitToCynoBeacons && !activeCynoBeacons.has(system.id)) return false;
  return true;
}

function distanceBetweenSystems(fromId: number, toId: number) {
  const from = graph?.systems[String(fromId)];
  const to = graph?.systems[String(toId)];
  if (!from || !to) return null;
  const dx = from.position.x - to.position.x;
  const dy = from.position.y - to.position.y;
  const dz = from.position.z - to.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function buildBridgeOnlyRoute(path: number[]): RouteOption | null {
  if (path.length < 2) return null;
  const bridgeLegs: BridgeLeg[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const parkingId = path[i];
    const endpointId = path[i + 1];
    const bridgeMeters = distanceBetweenSystems(parkingId, endpointId);
    if (bridgeMeters == null) return null;
    bridgeLegs.push({
      parkingId,
      endpointId,
      approachPath: [parkingId],
      approachJumps: 0,
      bridgeLy: bridgeMeters / LY,
    });
  }
  return {
    key: path.join('-'),
    bridgeLegs,
    postBridgePaths: [[path[path.length - 1]]],
    postBridgeJumps: 0,
    totalJumps: bridgeLegs.length,
    totalBridges: bridgeLegs.length,
  };
}

function compareRouteOptions(a: RouteOption, b: RouteOption) {
  if (a.totalJumps !== b.totalJumps) return a.totalJumps - b.totalJumps;
  if (a.totalBridges !== b.totalBridges) return a.totalBridges - b.totalBridges;
  if (a.postBridgeJumps !== b.postBridgeJumps) return a.postBridgeJumps - b.postBridgeJumps;
  const aBridgeLy = a.bridgeLegs.reduce((sum, leg) => sum + leg.bridgeLy, 0);
  const bBridgeLy = b.bridgeLegs.reduce((sum, leg) => sum + leg.bridgeLy, 0);
  if (aBridgeLy !== bBridgeLy) return aBridgeLy - bBridgeLy;
  return a.key.localeCompare(b.key);
}

function buildBridgeOnlyNeighborHelpers(
  sourceSystems: Array<{ id: number; x: number; y: number; z: number }>,
  landingSystems: Array<{ id: number; x: number; y: number; z: number }>,
  maxMetersSq: number
) {
  const outboundCache = new Map<number, Array<{ id: number; bridgeMeters: number }>>();
  const predecessorCache = new Map<number, number[]>();
  const landingIds = new Set<number>(landingSystems.map((system) => system.id));
  const sourceById = new Map<number, { id: number; x: number; y: number; z: number }>(sourceSystems.map((system) => [system.id, system]));
  const landingById = new Map<number, { id: number; x: number; y: number; z: number }>(landingSystems.map((system) => [system.id, system]));

  const getOutboundNeighbors = (sourceId: number) => {
    const cached = outboundCache.get(sourceId);
    if (cached) return cached;
    const source = sourceById.get(sourceId);
    if (!source) return [] as Array<{ id: number; bridgeMeters: number }>;
    const neighbors: Array<{ id: number; bridgeMeters: number }> = [];
    for (const target of landingSystems) {
      if (target.id === sourceId) continue;
      const dx = source.x - target.x;
      const dy = source.y - target.y;
      const dz = source.z - target.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxMetersSq) continue;
      neighbors.push({ id: target.id, bridgeMeters: Math.sqrt(d2) });
    }
    neighbors.sort((a, b) => {
      if (a.bridgeMeters !== b.bridgeMeters) return a.bridgeMeters - b.bridgeMeters;
      return a.id - b.id;
    });
    outboundCache.set(sourceId, neighbors);
    return neighbors;
  };

  const getPredecessors = (targetId: number) => {
    const cached = predecessorCache.get(targetId);
    if (cached) return cached;
    if (!landingIds.has(targetId)) return [] as number[];
    const target = landingById.get(targetId);
    if (!target) return [] as number[];
    const predecessors: number[] = [];
    for (const source of sourceSystems) {
      if (source.id === targetId) continue;
      const dx = source.x - target.x;
      const dy = source.y - target.y;
      const dz = source.z - target.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxMetersSq) continue;
      predecessors.push(source.id);
    }
    predecessorCache.set(targetId, predecessors);
    return predecessors;
  };

  return { getOutboundNeighbors, getPredecessors };
}

function computeBridgeOnlyHopDistances(
  stagingId: number,
  destinationId: number,
  getPredecessors: (targetId: number) => number[]
) {
  const dist = new Map<number, number>();
  const queue: number[] = [destinationId];
  dist.set(destinationId, 0);

  for (let qi = 0; qi < queue.length; qi++) {
    const currentId = queue[qi];
    const currentDist = dist.get(currentId);
    if (currentDist == null) continue;
    for (const prevId of getPredecessors(currentId)) {
      if (dist.has(prevId)) continue;
      dist.set(prevId, currentDist + 1);
      queue.push(prevId);
      if (prevId === stagingId) {
        continue;
      }
    }
  }

  return dist;
}

type BridgeOnlyPathCandidate = {
  path: number[];
  totalBridgeMeters: number;
};

function compareBridgeOnlyPathCandidates(a: BridgeOnlyPathCandidate, b: BridgeOnlyPathCandidate) {
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.totalBridgeMeters !== b.totalBridgeMeters) return a.totalBridgeMeters - b.totalBridgeMeters;
  return a.path.join('-').localeCompare(b.path.join('-'));
}

function findBridgeOnlyRoutesAtDepth(
  stagingId: number,
  destinationId: number,
  targetDepth: number,
  limit: number,
  getOutboundNeighbors: (sourceId: number) => Array<{ id: number; bridgeMeters: number }>,
  hopDistToDestination: Map<number, number>,
  maxExpansions: number,
  allowedFirstHopIds?: Set<number>
) {
  const best: BridgeOnlyPathCandidate[] = [];
  const path = [stagingId];
  const visited = new Set<number>([stagingId]);
  let expansions = 0;

  const dfs = (currentId: number, totalBridgeMeters: number) => {
    const usedDepth = path.length - 1;
    const remainingDepth = targetDepth - usedDepth;
    const minRemainingDepth = hopDistToDestination.get(currentId);
    if (minRemainingDepth == null || minRemainingDepth > remainingDepth) return;
    if (currentId === destinationId) {
      if (remainingDepth === 0) {
        insertCandidate(best, { path: [...path], totalBridgeMeters }, limit, compareBridgeOnlyPathCandidates);
      }
      return;
    }
    if (remainingDepth <= 0 || expansions >= maxExpansions) return;

    expansions += 1;
    let neighbors = getOutboundNeighbors(currentId);
    if (path.length === 1 && allowedFirstHopIds) {
      neighbors = neighbors.filter((neighbor) => allowedFirstHopIds.has(neighbor.id));
    }
    neighbors = neighbors
      .filter((neighbor) => !visited.has(neighbor.id))
      .filter((neighbor) => {
        const nextMinRemainingDepth = hopDistToDestination.get(neighbor.id);
        return nextMinRemainingDepth != null && nextMinRemainingDepth <= remainingDepth - 1;
      })
      .sort((a, b) => {
        const aRemaining = hopDistToDestination.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bRemaining = hopDistToDestination.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (aRemaining !== bRemaining) return aRemaining - bRemaining;
        if (a.bridgeMeters !== b.bridgeMeters) return a.bridgeMeters - b.bridgeMeters;
        return a.id - b.id;
      });

    for (const neighbor of neighbors) {
      visited.add(neighbor.id);
      path.push(neighbor.id);
      dfs(neighbor.id, totalBridgeMeters + neighbor.bridgeMeters);
      path.pop();
      visited.delete(neighbor.id);
      if (expansions >= maxExpansions) break;
    }
  };

  dfs(stagingId, 0);
  return best;
}

function buildNeighborMap(settings: TravelSettings) {
  if (!graph) return new Map<number, number[]>();
  const ansiFrom = buildAnsiMap(settings);
  const systems = graph.systems;
  const map = new Map<number, number[]>();
  const sameRegionOnly = !!settings.sameRegionOnly;
  const blacklist = buildBlacklistSet(settings);
  for (const [idStr, sys] of Object.entries(systems)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    if (settings.excludeZarzakh && id === 30100000) continue;
    if (blacklist.has(id)) continue;
    const neighbors: number[] = [];
    for (const next of sys.adjacentSystems || []) {
      if (settings.excludeZarzakh && next === 30100000) continue;
      if (blacklist.has(next)) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== sys.regionId) continue;
      neighbors.push(next);
    }
    if (settings.allowAnsiblex) {
      const outs = ansiFrom.get(id) || [];
      for (const next of outs) {
        if (settings.excludeZarzakh && next === 30100000) continue;
        if (blacklist.has(next)) continue;
        const nextNode = systems[String(next)];
        if (!nextNode) continue;
        if (sameRegionOnly && nextNode.regionId !== sys.regionId) continue;
        neighbors.push(next);
      }
    }
    map.set(id, neighbors);
  }
  return map;
}

function computeBestOneBridgeCosts(
  sources: Array<{ parkingId: number; endpointId: number; baseCost: number }>,
  settings: TravelSettings
) {
  const neighbors = buildNeighborMap(settings);
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const sourceParking = new Map<number, number>();
  const sourceEndpoint = new Map<number, number>();
  const heap = new MinHeap();

  for (const src of sources) {
    const prevCost = dist.get(src.parkingId);
    if (prevCost != null && prevCost <= src.baseCost) continue;
    dist.set(src.parkingId, src.baseCost);
    sourceParking.set(src.parkingId, src.parkingId);
    sourceEndpoint.set(src.parkingId, src.endpointId);
    heap.push({ id: src.parkingId, cost: src.baseCost });
  }

  while (heap.size > 0) {
    const item = heap.pop();
    if (!item) break;
    const curCost = dist.get(item.id);
    if (curCost == null || item.cost !== curCost) continue;
    const neighborsList = neighbors.get(item.id) || [];
    const srcParking = sourceParking.get(item.id);
    const srcEndpoint = sourceEndpoint.get(item.id);
    if (srcParking == null || srcEndpoint == null) continue;
    for (const next of neighborsList) {
      const nextCost = curCost + 1;
      const prevNextCost = dist.get(next);
      const shouldUpdate =
        prevNextCost == null ||
        nextCost < prevNextCost ||
        (nextCost === prevNextCost && (sourceParking.get(next) == null || srcParking < (sourceParking.get(next) as number)));
      if (!shouldUpdate) continue;
      dist.set(next, nextCost);
      prev.set(next, item.id);
      sourceParking.set(next, srcParking);
      sourceEndpoint.set(next, srcEndpoint);
      heap.push({ id: next, cost: nextCost });
    }
  }

  return { dist, prev, sourceParking, sourceEndpoint };
}

function getShardInfo(payload: ComputeRequest) {
  const shardCount = Math.max(1, Math.floor(payload.shardCount || 1));
  const shardIndex = Math.max(0, Math.min(shardCount - 1, Math.floor(payload.shardIndex || 0)));
  return { shardIndex, shardCount };
}

function shardByIndex<T>(items: T[], payload: ComputeRequest) {
  const { shardIndex, shardCount } = getShardInfo(payload);
  if (payload.mode !== 'pair-shard' || shardCount <= 1) return items;
  return items.filter((_, index) => index % shardCount === shardIndex);
}

function getEligibleParkingSystems(
  payload: ComputeRequest,
  blacklist: Set<number>,
  stagingDist?: Map<number, number>
) {
  return systemsList.filter((parking) => {
    if (payload.settings.bridgeFromStaging && parking.id !== payload.stagingId) return false;
    if (payload.settings.excludeZarzakh && parking.id === 30100000) return false;
    if (payload.settings.blacklistEnabled && blacklist.has(parking.id)) return false;
    if (isForbiddenSystem(parking)) return false;
    if (stagingDist && !stagingDist.has(parking.id)) return false;
    return true;
  });
}

function computeBridgeOnlyRoutes(
  payload: ComputeRequest,
  blacklist: Set<number>,
  activeCynoBeacons: Set<number>,
  limitToCynoBeacons: boolean,
  baselineJumps: number | null,
  onPartial?: (routes: RouteOption[], baselineJumps: number | null) => void,
  profile?: RouteProfile | null
) {
  const stagingNode = graph?.systems[String(payload.stagingId)];
  const destinationNode = graph?.systems[String(payload.destinationId)];
  if (!stagingNode || !destinationNode) {
    return { routes: [], message: 'Route endpoints not found.', baselineJumps };
  }

  if (isExcludedSystem(payload.stagingId, payload.settings, blacklist)) {
    return { routes: [], message: 'Starting system is excluded from bridge-only routing.', baselineJumps };
  }
  if (isForbiddenSystem(stagingNode)) {
    return { routes: [], message: 'Starting system is in highsec or Pochven.', baselineJumps };
  }

  const destinationSystem = systemsList.find((system) => system.id === payload.destinationId);
  if (!destinationSystem || !isValidBridgeLandingSystem(destinationSystem, payload.settings, blacklist, activeCynoBeacons, limitToCynoBeacons)) {
    return { routes: [], message: 'Destination cannot be reached by bridge-only routing.', baselineJumps };
  }

  const landingSystems = measureProfile(profile, 'endpoint/landing filtering', () => systemsList.filter((system) =>
    isValidBridgeLandingSystem(system, payload.settings, blacklist, activeCynoBeacons, limitToCynoBeacons)
  ));
  if (landingSystems.length === 0) {
    return { routes: [], message: 'No bridge destinations available for bridge-only routing.', baselineJumps };
  }

  const maxMeters = payload.bridgeRange * LY;
  const maxMetersSq = maxMeters * maxMeters;
  const sourceSystems = [
    {
      id: payload.stagingId,
      x: stagingNode.position.x,
      y: stagingNode.position.y,
      z: stagingNode.position.z,
    },
    ...landingSystems.filter((system) => system.id !== payload.stagingId),
  ];
  const { getOutboundNeighbors, getPredecessors } = measureProfile(
    profile,
    'bridge-only neighbor',
    () => buildBridgeOnlyNeighborHelpers(sourceSystems, landingSystems, maxMetersSq)
  );
  const hopDistToDestination = measureProfile(
    profile,
    'bridge-only hop-distance',
    () => computeBridgeOnlyHopDistances(payload.stagingId, payload.destinationId, getPredecessors)
  );
  const bestHopCount = hopDistToDestination.get(payload.stagingId);
  if (bestHopCount == null) {
    return { routes: [], message: 'No bridge-only chain found from starting system to destination.', baselineJumps };
  }
  const limit = Math.max(1, Math.min(25, payload.routesToShow || 5));
  const routes: RouteOption[] = [];
  const routeKeys = new Set<string>();
  const maxSearchDepth = Math.max(bestHopCount, bestHopCount + 12);
  const firstHopIds = payload.mode === 'pair-shard'
    ? new Set(shardByIndex(getOutboundNeighbors(payload.stagingId), payload).map((neighbor) => neighbor.id))
    : undefined;
  if (payload.mode === 'pair-shard' && firstHopIds?.size === 0) {
    return { routes: [], message: 'No bridge-only route found.', baselineJumps };
  }

  for (let depth = bestHopCount; depth <= maxSearchDepth && routes.length < limit; depth++) {
    const candidates = measureProfile(
      profile,
      'bridge-only search',
      () => findBridgeOnlyRoutesAtDepth(
        payload.stagingId,
        payload.destinationId,
        depth,
        limit,
        getOutboundNeighbors,
        hopDistToDestination,
        Math.max(20000, limit * 15000),
        firstHopIds
      )
    );
    for (const candidate of candidates) {
      const route = buildBridgeOnlyRoute(candidate.path);
      if (!route || routeKeys.has(route.key)) continue;
      routeKeys.add(route.key);
      routes.push(route);
      onPartial?.(routes, baselineJumps);
      if (routes.length >= limit) break;
    }
  }

  if (routes.length === 0) {
    return { routes: [], message: 'No bridge-only route found.', baselineJumps };
  }

  return { routes, message: null, baselineJumps };
}

function computePairRoutes(
  payload: ComputeRequest,
  onPartial?: (routes: RouteOption[], baselineJumps: number | null) => void,
  profile?: RouteProfile | null
): { routes: RouteOption[]; message: string | null; baselineJumps: number | null } {
  if (!graph) return { routes: [], message: 'Graph not loaded.', baselineJumps: null };
  const systems = graph.systems;
  const destinationNode = systems[String(payload.destinationId)];
  const stagingNode = systems[String(payload.stagingId)];
  if (!destinationNode) return { routes: [], message: 'Destination system not found.', baselineJumps: null };
  if (!stagingNode) return { routes: [], message: 'Staging system not found.', baselineJumps: null };
  const blacklist = buildBlacklistSet(payload.settings);
  const activeCynoBeacons = buildCynoBeaconSet(payload.settings);
  const limitToCynoBeacons = !!payload.settings.limitToCynoBeacons;
  if (payload.settings.blacklistEnabled && blacklist.has(payload.destinationId)) {
    return { routes: [], message: 'Destination system is blacklisted.', baselineJumps: null };
  }
  if (payload.settings.blacklistEnabled && blacklist.has(payload.stagingId)) {
    return { routes: [], message: 'Staging system is blacklisted.', baselineJumps: null };
  }
  if (payload.settings.bridgeFromStaging && isForbiddenSystem(stagingNode)) {
    return { routes: [], message: 'Starting system is in highsec or Pochven.', baselineJumps: null };
  }
  if (limitToCynoBeacons && activeCynoBeacons.size === 0) {
    return { routes: [], message: 'No active cyno beacons configured.', baselineJumps: null };
  }

  const maxMeters = payload.bridgeRange * LY;
  const maxMetersSq = maxMeters * maxMeters;

  const { dist: stagingDist, prev: stagingPrev } = measureProfile(
    profile,
    'travel-tree BFS',
    () => computeTravelTree(payload.stagingId, payload.settings, MAX_TRAVEL_JUMPS)
  );
  const { dist: destinationDist, prev: destinationPrev } = measureProfile(
    profile,
    'travel-tree BFS',
    () => computeTravelTree(payload.destinationId, payload.settings, MAX_TRAVEL_JUMPS)
  );

  const baselineJumps = stagingDist.get(payload.destinationId) ?? null;

  if (payload.settings.bridgeOnlyChain) {
    return computeBridgeOnlyRoutes(payload, blacklist, activeCynoBeacons, limitToCynoBeacons, baselineJumps, onPartial, profile);
  }

  const endpointList = measureProfile(profile, 'endpoint/landing filtering', () => {
    const endpoints: Array<{ id: number; x: number; y: number; z: number; jumps: number }> = [];
    if (payload.settings.bridgeIntoDestination) {
      if (isForbiddenSystem(destinationNode)) {
        return endpoints;
      }
      const destJumps = destinationDist.get(payload.destinationId);
      if (destJumps != null && (!limitToCynoBeacons || activeCynoBeacons.has(payload.destinationId))) {
        endpoints.push({
          id: payload.destinationId,
          x: destinationNode.position.x,
          y: destinationNode.position.y,
          z: destinationNode.position.z,
          jumps: destJumps,
        });
      }
    } else {
      for (const sys of systemsList) {
        if (payload.settings.blacklistEnabled && blacklist.has(sys.id)) continue;
        if (isForbiddenSystem(sys)) continue;
        if (limitToCynoBeacons && !activeCynoBeacons.has(sys.id)) continue;
        const jumps = destinationDist.get(sys.id);
        if (jumps == null) continue;
        endpoints.push({ id: sys.id, x: sys.x, y: sys.y, z: sys.z, jumps });
      }
    }
    return endpoints;
  });

  if (payload.settings.bridgeIntoDestination && endpointList.length === 0 && isForbiddenSystem(destinationNode)) {
    return { routes: [], message: 'Cannot bridge directly into a destination in highsec or Pochven.', baselineJumps };
  }

  if (endpointList.length === 0) {
    if (limitToCynoBeacons) {
      if (payload.settings.bridgeIntoDestination) {
        return { routes: [], message: 'Destination does not have an active cyno beacon.', baselineJumps };
      }
      return { routes: [], message: 'No bridge destinations with active cyno beacons found.', baselineJumps };
    }
    return { routes: [], message: 'No destination routes found.', baselineJumps };
  }

  const limit = Math.max(1, Math.min(25, payload.routesToShow || 5));
  const bridgeCount = Math.max(1, Math.min(2, payload.settings.bridgeCount ?? 1));
  const parkingSystems = shardByIndex(getEligibleParkingSystems(payload, blacklist, stagingDist), payload);

  if (bridgeCount === 1) {
    const best: Candidate[] = [];
    let lastEmit = 0;
    const emit = (force = false) => {
      if (!onPartial) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!force && now - lastEmit < 80) return;
      lastEmit = now;
      const routes = buildRoutesFromCandidates(best, stagingPrev, destinationPrev, payload.stagingId, payload.destinationId, blacklist);
      onPartial(routes, baselineJumps);
    };

    measureProfile(profile, 'one-bridge scan', () => {
    for (const parking of parkingSystems) {
      const stagingJumps = stagingDist.get(parking.id);
      if (stagingJumps == null) continue;
      let bestEndpoint: { id: number; jumps: number; bridgeMetersSq: number } | null = null;
      for (const endpoint of endpointList) {
        const dx = parking.x - endpoint.x;
        const dy = parking.y - endpoint.y;
        const dz = parking.z - endpoint.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxMetersSq) continue;
        if (
          !bestEndpoint ||
          endpoint.jumps < bestEndpoint.jumps ||
          (endpoint.jumps === bestEndpoint.jumps && d2 < bestEndpoint.bridgeMetersSq)
        ) {
          bestEndpoint = { id: endpoint.id, jumps: endpoint.jumps, bridgeMetersSq: d2 };
        }
      }
      if (!bestEndpoint) continue;
      const totalJumps = stagingJumps + bestEndpoint.jumps;
      const cand: Candidate = {
        parkingId: parking.id,
        endpointId: bestEndpoint.id,
        stagingJumps,
        destinationJumps: bestEndpoint.jumps,
        bridgeMeters: Math.sqrt(bestEndpoint.bridgeMetersSq),
        totalJumps,
      };
      const changed = insertCandidate(best, cand, limit, compareOneBridgeCandidates);
      if (changed) {
        emit(best.length === 1);
      }
    }
    });

    if (best.length === 0) {
      if (limitToCynoBeacons) {
        return { routes: [], message: 'No reachable parking systems found within bridge range of an active cyno beacon.', baselineJumps };
      }
      return { routes: [], message: 'No reachable parking systems found.', baselineJumps };
    }

    const routes = buildRoutesFromCandidates(best, stagingPrev, destinationPrev, payload.stagingId, payload.destinationId, blacklist);
    if (routes.length === 0) {
      return { routes: [], message: 'No routes found.', baselineJumps };
    }

    return { routes, message: null, baselineJumps };
  }

  const bridgeInfoByParking = new Map<number, { endpointId: number; destinationJumps: number; bridgeMeters: number }>();
  const bridgeSources: Array<{ parkingId: number; endpointId: number; baseCost: number }> = [];
  measureProfile(profile, 'two-bridge setup', () => {
    for (const parking of systemsList) {
      if (payload.settings.excludeZarzakh && parking.id === 30100000) continue;
      if (payload.settings.blacklistEnabled && blacklist.has(parking.id)) continue;
      if (isForbiddenSystem(parking)) continue;
      let bestEndpoint: { id: number; jumps: number; bridgeMetersSq: number } | null = null;
      for (const endpoint of endpointList) {
        const dx = parking.x - endpoint.x;
        const dy = parking.y - endpoint.y;
        const dz = parking.z - endpoint.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxMetersSq) continue;
        if (
          !bestEndpoint ||
          endpoint.jumps < bestEndpoint.jumps ||
          (endpoint.jumps === bestEndpoint.jumps && d2 < bestEndpoint.bridgeMetersSq)
        ) {
          bestEndpoint = { id: endpoint.id, jumps: endpoint.jumps, bridgeMetersSq: d2 };
        }
      }
      if (!bestEndpoint) continue;
      bridgeInfoByParking.set(parking.id, { endpointId: bestEndpoint.id, destinationJumps: bestEndpoint.jumps, bridgeMeters: Math.sqrt(bestEndpoint.bridgeMetersSq) });
      bridgeSources.push({ parkingId: parking.id, endpointId: bestEndpoint.id, baseCost: bestEndpoint.jumps });
    }
  });

  if (bridgeSources.length === 0) {
    if (limitToCynoBeacons) {
      return { routes: [], message: 'No reachable second-bridge parking systems found near an active cyno beacon.', baselineJumps };
    }
    return { routes: [], message: 'No reachable second-bridge parking systems found.', baselineJumps };
  }

  const { dist: oneBridgeDist, prev: oneBridgePrev, sourceParking, sourceEndpoint } = measureProfile(
    profile,
    'two-bridge setup',
    () => computeBestOneBridgeCosts(bridgeSources, payload.settings)
  );
  const endpoint1List: Array<{ id: number; x: number; y: number; z: number; cost: number }> = [];
  for (const sys of systemsList) {
    const cost = oneBridgeDist.get(sys.id);
    if (cost == null) continue;
    if (payload.settings.bridgeContinuous && sourceParking.get(sys.id) !== sys.id) continue;
    if (payload.settings.blacklistEnabled && blacklist.has(sys.id)) continue;
    if (isForbiddenSystem(sys)) continue;
    if (limitToCynoBeacons && !activeCynoBeacons.has(sys.id)) continue;
    endpoint1List.push({ id: sys.id, x: sys.x, y: sys.y, z: sys.z, cost });
  }

  if (endpoint1List.length === 0) {
    if (limitToCynoBeacons) {
      return { routes: [], message: 'No reachable bridge endpoints with active cyno beacons found.', baselineJumps };
    }
    return { routes: [], message: 'No reachable bridge endpoints found.', baselineJumps };
  }

  const bestTwo: TwoBridgeCandidate[] = [];
  let lastEmitTwo = 0;
  const emitTwo = (force = false) => {
    if (!onPartial) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - lastEmitTwo < 80) return;
    lastEmitTwo = now;
    const routes = buildRoutesFromTwoBridgeCandidates(
      bestTwo,
      stagingPrev,
      destinationPrev,
      oneBridgePrev,
      payload.stagingId,
      payload.destinationId,
      blacklist
    );
    onPartial(routes, baselineJumps);
  };

  measureProfile(profile, 'two-bridge scan', () => {
  for (const parking of parkingSystems) {
    const stagingJumps = stagingDist.get(parking.id);
    if (stagingJumps == null) continue;
    let bestEndpoint: { id: number; cost: number; bridgeMetersSq: number } | null = null;
    for (const endpoint of endpoint1List) {
      const dx = parking.x - endpoint.x;
      const dy = parking.y - endpoint.y;
      const dz = parking.z - endpoint.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxMetersSq) continue;
      const totalCost = stagingJumps + endpoint.cost;
      if (
        !bestEndpoint ||
        totalCost < stagingJumps + bestEndpoint.cost ||
        (totalCost === stagingJumps + bestEndpoint.cost && d2 < bestEndpoint.bridgeMetersSq)
      ) {
        bestEndpoint = { id: endpoint.id, cost: endpoint.cost, bridgeMetersSq: d2 };
      }
    }
    if (!bestEndpoint) continue;
    const parking2Id = sourceParking.get(bestEndpoint.id);
    const endpoint2Id = sourceEndpoint.get(bestEndpoint.id);
    if (parking2Id == null || endpoint2Id == null) continue;
    const bridgeInfo = bridgeInfoByParking.get(parking2Id);
    if (!bridgeInfo) continue;
    const midTravelJumps = Math.max(0, bestEndpoint.cost - bridgeInfo.destinationJumps);
    const totalJumps = stagingJumps + bestEndpoint.cost;
    const cand: TwoBridgeCandidate = {
      parkingId: parking.id,
      endpointId: bestEndpoint.id,
      parking2Id,
      endpoint2Id,
      stagingJumps,
      midTravelJumps,
      destinationJumps: bridgeInfo.destinationJumps,
      bridgeMeters: Math.sqrt(bestEndpoint.bridgeMetersSq),
      bridge2Meters: bridgeInfo.bridgeMeters,
      totalJumps,
    };
    const changed = insertCandidate(bestTwo, cand, limit, compareTwoBridgeCandidates);
    if (changed) {
      emitTwo(bestTwo.length === 1);
    }
  }
  });

  if (bestTwo.length === 0) {
    if (limitToCynoBeacons) {
      return { routes: [], message: 'No reachable two-bridge routes found using active cyno beacons.', baselineJumps };
    }
    return { routes: [], message: 'No reachable two-bridge routes found.', baselineJumps };
  }

  const routes = buildRoutesFromTwoBridgeCandidates(
    bestTwo,
    stagingPrev,
    destinationPrev,
    oneBridgePrev,
    payload.stagingId,
    payload.destinationId,
    blacklist
  );
  if (routes.length === 0) {
    return { routes: [], message: 'No routes found.', baselineJumps };
  }

  return { routes, message: null, baselineJumps };
}

function buildTrivialRoute(id: number, key: string): RouteOption {
  return {
    key,
    bridgeLegs: [],
    postBridgePaths: [[id]],
    postBridgeJumps: 0,
    totalJumps: 0,
    totalBridges: 0,
  };
}

function buildGateOnlyRoute(path: number[], key: string): RouteOption | null {
  if (path.length === 0) return null;
  const jumps = Math.max(0, path.length - 1);
  return {
    key,
    bridgeLegs: [],
    postBridgePaths: [path],
    postBridgeJumps: jumps,
    totalJumps: jumps,
    totalBridges: 0,
  };
}

function getWaypointSegmentLabel(segmentIndex: number, totalSegments: number) {
  if (totalSegments <= 1) return 'route';
  if (segmentIndex === 0) return 'the first leg';
  if (segmentIndex === totalSegments - 1) return 'the final leg';
  return `waypoint leg ${segmentIndex}`;
}

function mergeWaypointRoute(prefix: RouteOption, route: RouteOption, waypointIds: number[]) {
  const key = prefix.key === 'root' ? route.key : `${prefix.key}__${route.key}`;
  return {
    key,
    bridgeLegs: [...prefix.bridgeLegs, ...route.bridgeLegs],
    postBridgePaths: [...prefix.postBridgePaths, ...route.postBridgePaths].filter((path) => path.length > 0 && path[0] !== -1),
    postBridgeJumps: prefix.postBridgeJumps + route.postBridgeJumps,
    totalJumps: prefix.totalJumps + route.totalJumps,
    totalBridges: prefix.totalBridges + route.totalBridges,
    waypointIds,
  };
}

function reduceWaypointRoutes(routes: RouteOption[], limit: number) {
  const byKey = new Map<string, RouteOption>();
  for (const route of routes) {
    const existing = byKey.get(route.key);
    if (!existing || compareRouteOptions(route, existing) < 0) {
      byKey.set(route.key, route);
    }
  }
  return Array.from(byKey.values())
    .sort(compareRouteOptions)
    .slice(0, limit);
}

function combineWaypointRoutes(
  segmentRoutes: RouteOption[][],
  waypointIds: number[],
  limit: number
) {
  let combined: RouteOption[] = [buildTrivialRoute(-1, 'root')];

  for (const routes of segmentRoutes) {
    const next: RouteOption[] = [];
    const seen = new Set<string>();

    for (const prefix of combined) {
      for (const route of routes) {
        const merged = mergeWaypointRoute(prefix, route, waypointIds);
        if (seen.has(merged.key)) continue;
        seen.add(merged.key);
        next.push(merged);
      }
    }

    next.sort(compareRouteOptions);
    combined = next.slice(0, limit);
    if (combined.length === 0) break;
  }

  return combined;
}

function combineWaypointRoutesWithBridgeBudget(
  segmentRoutes: RouteOption[][],
  waypointIds: number[],
  limit: number,
  totalBridgeBudget: number
) {
  let combinedByBridges = new Map<number, RouteOption[]>([[0, [buildTrivialRoute(-1, 'root')]]]);

  for (const routes of segmentRoutes) {
    const nextByBridges = new Map<number, RouteOption[]>();

    for (const [usedBridges, prefixes] of combinedByBridges.entries()) {
      for (const prefix of prefixes) {
        for (const route of routes) {
          const nextUsedBridges = usedBridges + route.totalBridges;
          if (nextUsedBridges > totalBridgeBudget) continue;
          const merged = mergeWaypointRoute(prefix, route, waypointIds);
          const bucket = nextByBridges.get(nextUsedBridges) || [];
          bucket.push(merged);
          nextByBridges.set(nextUsedBridges, bucket);
        }
      }
    }

    combinedByBridges = new Map(
      Array.from(nextByBridges.entries()).map(([usedBridges, bucketRoutes]) => [
        usedBridges,
        reduceWaypointRoutes(bucketRoutes, limit),
      ])
    );

    if (combinedByBridges.size === 0) break;
  }

  return combinedByBridges.get(totalBridgeBudget) || [];
}

function buildWaypointSegmentSettings(
  settings: TravelSettings,
  segmentIndex: number,
  segmentCount: number,
  bridgeCount: number
): TravelSettings {
  const isFirstSegment = segmentIndex === 0;
  const isLastSegment = segmentIndex === segmentCount - 1;
  return {
    ...settings,
    bridgeOnlyChain: false,
    bridgeCount,
    bridgeContinuous: bridgeCount === 2 ? !!settings.bridgeContinuous : false,
    bridgeFromStaging: bridgeCount > 0 && isFirstSegment ? !!settings.bridgeFromStaging : false,
    bridgeIntoDestination: bridgeCount > 0 && isLastSegment ? !!settings.bridgeIntoDestination : false,
  };
}

function buildWaypointSegmentRouteOptions(
  payload: ComputeRequest,
  fromId: number,
  toId: number,
  segmentIndex: number,
  segmentCount: number,
  totalBridgeBudget: number,
  profile?: RouteProfile | null
) {
  const routes: RouteOption[] = [];
  const gateTravelSettings = buildWaypointSegmentSettings(payload.settings, segmentIndex, segmentCount, 0);
  const { dist: gateDist, prev: gatePrev } = measureProfile(
    profile,
    'travel-tree BFS',
    () => computeTravelTree(fromId, gateTravelSettings, MAX_TRAVEL_JUMPS)
  );
  const baselineJumps = gateDist.get(toId) ?? null;
  const gatePath = baselineJumps == null ? null : buildPath(gatePrev, fromId, toId);
  const gateRoute = gatePath ? buildGateOnlyRoute(gatePath, `gate-${segmentIndex}-${fromId}-${toId}`) : null;
  if (gateRoute) routes.push(gateRoute);

  const maxSegmentBridges = Math.max(0, Math.min(totalBridgeBudget, 2));
  for (let bridgeCount = 1; bridgeCount <= maxSegmentBridges; bridgeCount++) {
    const segmentResult = computePairRoutes({
      ...payload,
      stagingId: fromId,
      destinationId: toId,
      waypointIds: [],
      settings: buildWaypointSegmentSettings(payload.settings, segmentIndex, segmentCount, bridgeCount),
    }, undefined, profile);
    if (segmentResult.routes.length === 0) continue;
    routes.push(...segmentResult.routes);
  }

  return {
    routes: reduceWaypointRoutes(routes, Math.max(25, payload.routesToShow || 5) * 3),
    baselineJumps,
    message: routes.length === 0 ? 'No gate or bridge route found for this leg.' : null,
  };
}

function computeWaypointSegment(payload: ComputeRequest, profile?: RouteProfile | null) {
  const segmentIndex = Math.max(0, payload.segmentIndex ?? 0);
  const segmentCount = Math.max(1, payload.segmentCount ?? 1);

  if (payload.stagingId === payload.destinationId) {
    return {
      routes: [buildTrivialRoute(payload.stagingId, `same-${segmentIndex}-${payload.stagingId}`)],
      message: null,
      baselineJumps: 0,
    };
  }

  if (payload.settings.bridgeOnlyChain) {
    return computePairRoutes({
      ...payload,
      waypointIds: [],
    }, undefined, profile);
  }

  return buildWaypointSegmentRouteOptions(
    payload,
    payload.stagingId,
    payload.destinationId,
    segmentIndex,
    segmentCount,
    Math.max(1, Math.min(2, payload.totalBridgeBudget ?? payload.settings.bridgeCount ?? 1)),
    profile
  );
}

function computeRoutes(
  payload: ComputeRequest,
  onPartial?: (routes: RouteOption[], baselineJumps: number | null) => void,
  profile?: RouteProfile | null
): { routes: RouteOption[]; message: string | null; baselineJumps: number | null } {
  if (payload.mode === 'waypoint-segment') {
    return measureProfile(profile, 'waypoint segment calculation', () => computeWaypointSegment(payload, profile));
  }

  const waypointIds = Array.isArray(payload.waypointIds)
    ? payload.waypointIds.filter((id): id is number => Number.isFinite(id))
    : [];
  if (waypointIds.length === 0) {
    return computePairRoutes(payload, onPartial, profile);
  }

  if (payload.settings.bridgeOnlyChain) {
    const stopIds = [payload.stagingId, ...waypointIds, payload.destinationId];
    const segmentCount = stopIds.length - 1;
    const segmentRouteLists: RouteOption[][] = [];
    let combinedBaselineJumps: number | null = 0;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const fromId = stopIds[segmentIndex];
      const toId = stopIds[segmentIndex + 1];

      if (fromId === toId) {
        segmentRouteLists.push([buildTrivialRoute(fromId, `same-${segmentIndex}-${fromId}`)]);
        continue;
      }

      const segmentResult = computePairRoutes({
        ...payload,
        stagingId: fromId,
        destinationId: toId,
        waypointIds: [],
      }, undefined, profile);

      if (combinedBaselineJumps != null) {
        combinedBaselineJumps = segmentResult.baselineJumps == null
          ? null
          : combinedBaselineJumps + segmentResult.baselineJumps;
      }

      if (segmentResult.routes.length === 0) {
        return {
          routes: [],
          message: `Could not route ${getWaypointSegmentLabel(segmentIndex, segmentCount)}. ${segmentResult.message ?? 'No route found.'}`,
          baselineJumps: combinedBaselineJumps,
        };
      }

      segmentRouteLists.push(segmentResult.routes);
    }

    const limit = Math.max(1, Math.min(25, payload.routesToShow || 5));
    const routes = combineWaypointRoutes(segmentRouteLists, waypointIds, limit);
    if (routes.length === 0) {
      return { routes: [], message: 'No routes found through the selected waypoints.', baselineJumps: combinedBaselineJumps };
    }

    return { routes, message: null, baselineJumps: combinedBaselineJumps };
  }

  const stopIds = [payload.stagingId, ...waypointIds, payload.destinationId];
  const segmentCount = stopIds.length - 1;
  const segmentRouteLists: RouteOption[][] = [];
  let combinedBaselineJumps: number | null = 0;
  const totalBridgeBudget = Math.max(1, Math.min(2, payload.settings.bridgeCount ?? 1));

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const fromId = stopIds[segmentIndex];
    const toId = stopIds[segmentIndex + 1];

    if (fromId === toId) {
      segmentRouteLists.push([buildTrivialRoute(fromId, `same-${segmentIndex}-${fromId}`)]);
      continue;
    }

    const segmentResult = buildWaypointSegmentRouteOptions(
      payload,
      fromId,
      toId,
      segmentIndex,
      segmentCount,
      totalBridgeBudget,
      profile
    );

    if (combinedBaselineJumps != null) {
      combinedBaselineJumps = segmentResult.baselineJumps == null
        ? null
        : combinedBaselineJumps + segmentResult.baselineJumps;
    }

    if (segmentResult.routes.length === 0) {
      return {
        routes: [],
        message: `Could not route ${getWaypointSegmentLabel(segmentIndex, segmentCount)}. ${segmentResult.message ?? 'No route found.'}`,
        baselineJumps: combinedBaselineJumps,
      };
    }

    segmentRouteLists.push(segmentResult.routes);
  }

  const limit = Math.max(1, Math.min(25, payload.routesToShow || 5));
  const routes = combineWaypointRoutesWithBridgeBudget(segmentRouteLists, waypointIds, limit, totalBridgeBudget);
  if (routes.length === 0) {
    return {
      routes: [],
      message: `No routes found through the selected waypoints using ${totalBridgeBudget} total bridge${totalBridgeBudget === 1 ? '' : 's'}.`,
      baselineJumps: combinedBaselineJumps,
    };
  }

  return { routes, message: null, baselineJumps: combinedBaselineJumps };
}

self.onmessage = (event: MessageEvent<InitRequest | ComputeRequest>) => {
  const data = event.data;
  if (data.type === 'init') {
    graph = data.graph;
    buildSystemsList(data.graph);
    travelTreeCache = new Map();
    return;
  }
  if (data.type === 'compute') {
    const profile = createRouteProfile(data);
    const result = computeRoutes(data, (routes, baselineJumps) => {
      self.postMessage({ type: 'partial', requestId: data.requestId, segmentIndex: data.segmentIndex, routes, message: null, baselineJumps });
    }, profile);
    logProfile(profile);
    self.postMessage({ type: 'result', requestId: data.requestId, segmentIndex: data.segmentIndex, ...result });
  }
};

export {};
