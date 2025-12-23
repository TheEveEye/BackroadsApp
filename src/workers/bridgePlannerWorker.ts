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
type TravelSettings = {
  excludeZarzakh?: boolean;
  sameRegionOnly?: boolean;
  bridgeIntoDestination?: boolean;
  bridgeFromStaging?: boolean;
  bridgeCount?: number;
  allowAnsiblex?: boolean;
  ansiblexes?: AnsiblexBridge[];
};

type ComputeRequest = {
  type: 'compute';
  requestId: number;
  destinationId: number;
  stagingId: number;
  bridgeRange: number;
  routesToShow: number;
  settings: TravelSettings;
};

type InitRequest = {
  type: 'init';
  graph: GraphData;
};

type RouteOption = {
  key: string;
  travelPath: number[];
  postBridgePath: number[];
  parkingId: number;
  bridgeEndpointId: number;
  travelJumps: number;
  postBridgeJumps: number;
  totalJumps: number;
  bridgeLy: number;
  midTravelPath?: number[] | null;
  parking2Id?: number | null;
  bridgeEndpoint2Id?: number | null;
  midTravelJumps?: number;
  bridge2Ly?: number;
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

let graph: GraphData | null = null;
let systemsList: Array<{ id: number; x: number; y: number; z: number; regionId: number; security: number | null; adjacentSystems: number[] }> = [];

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

function computeTravelTree(startId: number, settings: TravelSettings, maxJumps: number) {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  if (!graph) return { dist, prev };
  const systems = graph.systems;
  const start = systems[String(startId)];
  if (!start) return { dist, prev };

  const exclude = new Set<number>();
  if (settings.excludeZarzakh) exclude.add(30100000);
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
    if (exclude.has(id)) continue;
    if (sameRegionOnly && node.regionId !== startRegion) continue;

    for (const next of node.adjacentSystems) {
      if (exclude.has(next)) continue;
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
        if (exclude.has(next)) continue;
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
  destinationId: number
): RouteOption[] {
  const routes: RouteOption[] = [];
  for (const c of candidates) {
    const travelPath = buildPath(stagingPrev, stagingId, c.parkingId);
    const destinationPath = buildPath(destinationPrev, destinationId, c.endpointId);
    if (!travelPath || !destinationPath) continue;
    routes.push({
      key: `${c.parkingId}-${c.endpointId}`,
      travelPath,
      postBridgePath: destinationPath.slice().reverse(),
      parkingId: c.parkingId,
      bridgeEndpointId: c.endpointId,
      travelJumps: c.stagingJumps,
      postBridgeJumps: c.destinationJumps,
      totalJumps: c.totalJumps,
      bridgeLy: c.bridgeMeters / LY,
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
  destinationId: number
): RouteOption[] {
  const routes: RouteOption[] = [];
  for (const c of candidates) {
    const travelPath = buildPath(stagingPrev, stagingId, c.parkingId);
    const midPath = buildPathToSource(midPrev, c.endpointId, c.parking2Id);
    const destinationPath = buildPath(destinationPrev, destinationId, c.endpoint2Id);
    if (!travelPath || !midPath || !destinationPath) continue;
    routes.push({
      key: `${c.parkingId}-${c.endpointId}-${c.parking2Id}-${c.endpoint2Id}`,
      travelPath,
      midTravelPath: midPath,
      postBridgePath: destinationPath.slice().reverse(),
      parkingId: c.parkingId,
      bridgeEndpointId: c.endpointId,
      parking2Id: c.parking2Id,
      bridgeEndpoint2Id: c.endpoint2Id,
      travelJumps: c.stagingJumps,
      midTravelJumps: c.midTravelJumps,
      postBridgeJumps: c.destinationJumps,
      totalJumps: c.totalJumps,
      bridgeLy: c.bridgeMeters / LY,
      bridge2Ly: c.bridge2Meters / LY,
    });
  }
  return routes;
}

function buildNeighborMap(settings: TravelSettings) {
  if (!graph) return new Map<number, number[]>();
  const ansiFrom = buildAnsiMap(settings);
  const systems = graph.systems;
  const map = new Map<number, number[]>();
  const sameRegionOnly = !!settings.sameRegionOnly;
  for (const [idStr, sys] of Object.entries(systems)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    if (settings.excludeZarzakh && id === 30100000) continue;
    const neighbors: number[] = [];
    for (const next of sys.adjacentSystems || []) {
      if (settings.excludeZarzakh && next === 30100000) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== sys.regionId) continue;
      neighbors.push(next);
    }
    if (settings.allowAnsiblex) {
      const outs = ansiFrom.get(id) || [];
      for (const next of outs) {
        if (settings.excludeZarzakh && next === 30100000) continue;
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

function computeRoutes(
  payload: ComputeRequest,
  onPartial?: (routes: RouteOption[], baselineJumps: number | null) => void
): { routes: RouteOption[]; message: string | null; baselineJumps: number | null } {
  if (!graph) return { routes: [], message: 'Graph not loaded.', baselineJumps: null };
  const systems = graph.systems;
  const destinationNode = systems[String(payload.destinationId)];
  const stagingNode = systems[String(payload.stagingId)];
  if (!destinationNode) return { routes: [], message: 'Destination system not found.', baselineJumps: null };
  if (!stagingNode) return { routes: [], message: 'Staging system not found.', baselineJumps: null };
  if (isForbiddenSystem(destinationNode)) {
    return { routes: [], message: 'Destination is in highsec or Pochven.', baselineJumps: null };
  }
  if (payload.settings.bridgeFromStaging && isForbiddenSystem(stagingNode)) {
    return { routes: [], message: 'Starting system is in highsec or Pochven.', baselineJumps: null };
  }

  const maxMeters = payload.bridgeRange * LY;
  const maxMetersSq = maxMeters * maxMeters;

  const { dist: stagingDist, prev: stagingPrev } = computeTravelTree(payload.stagingId, payload.settings, MAX_TRAVEL_JUMPS);
  const { dist: destinationDist, prev: destinationPrev } = computeTravelTree(payload.destinationId, payload.settings, MAX_TRAVEL_JUMPS);

  const baselineJumps = stagingDist.get(payload.destinationId) ?? null;

  const endpointList: Array<{ id: number; x: number; y: number; z: number; jumps: number }> = [];
  if (payload.settings.bridgeIntoDestination) {
    const destJumps = destinationDist.get(payload.destinationId);
    if (destJumps != null) {
      endpointList.push({
        id: payload.destinationId,
        x: destinationNode.position.x,
        y: destinationNode.position.y,
        z: destinationNode.position.z,
        jumps: destJumps,
      });
    }
  } else {
    for (const sys of systemsList) {
      const jumps = destinationDist.get(sys.id);
      if (jumps == null) continue;
      endpointList.push({ id: sys.id, x: sys.x, y: sys.y, z: sys.z, jumps });
    }
  }

  if (endpointList.length === 0) {
    return { routes: [], message: 'No destination routes found.', baselineJumps };
  }

  const limit = Math.max(1, Math.min(25, payload.routesToShow || 5));
  const bridgeCount = Math.max(1, Math.min(2, payload.settings.bridgeCount ?? 1));

  if (bridgeCount === 1) {
    const best: Candidate[] = [];
    let lastEmit = 0;
    const emit = (force = false) => {
      if (!onPartial) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!force && now - lastEmit < 80) return;
      lastEmit = now;
      const routes = buildRoutesFromCandidates(best, stagingPrev, destinationPrev, payload.stagingId, payload.destinationId);
      onPartial(routes, baselineJumps);
    };

    for (const parking of systemsList) {
      if (payload.settings.bridgeFromStaging && parking.id !== payload.stagingId) continue;
      if (payload.settings.excludeZarzakh && parking.id === 30100000) continue;
      if (isForbiddenSystem(parking)) continue;
      const stagingJumps = stagingDist.get(parking.id);
      if (stagingJumps == null) continue;
      let bestEndpoint: { id: number; jumps: number; bridgeMeters: number } | null = null;
      for (const endpoint of endpointList) {
        const dx = parking.x - endpoint.x;
        const dy = parking.y - endpoint.y;
        const dz = parking.z - endpoint.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxMetersSq) continue;
        const bridgeMeters = Math.sqrt(d2);
        if (
          !bestEndpoint ||
          endpoint.jumps < bestEndpoint.jumps ||
          (endpoint.jumps === bestEndpoint.jumps && bridgeMeters < bestEndpoint.bridgeMeters)
        ) {
          bestEndpoint = { id: endpoint.id, jumps: endpoint.jumps, bridgeMeters };
        }
      }
      if (!bestEndpoint) continue;
      const totalJumps = stagingJumps + bestEndpoint.jumps;
      const cand: Candidate = {
        parkingId: parking.id,
        endpointId: bestEndpoint.id,
        stagingJumps,
        destinationJumps: bestEndpoint.jumps,
        bridgeMeters: bestEndpoint.bridgeMeters,
        totalJumps,
      };
      const changed = insertCandidate(best, cand, limit, compareOneBridgeCandidates);
      if (changed) {
        emit(best.length === 1);
      }
    }

    if (best.length === 0) {
      return { routes: [], message: 'No reachable parking systems found.', baselineJumps };
    }

    const routes = buildRoutesFromCandidates(best, stagingPrev, destinationPrev, payload.stagingId, payload.destinationId);
    if (routes.length === 0) {
      return { routes: [], message: 'No routes found.', baselineJumps };
    }

    return { routes, message: null, baselineJumps };
  }

  const bridgeInfoByParking = new Map<number, { endpointId: number; destinationJumps: number; bridgeMeters: number }>();
  const bridgeSources: Array<{ parkingId: number; endpointId: number; baseCost: number }> = [];
  for (const parking of systemsList) {
    if (payload.settings.excludeZarzakh && parking.id === 30100000) continue;
    if (isForbiddenSystem(parking)) continue;
    let bestEndpoint: { id: number; jumps: number; bridgeMeters: number } | null = null;
    for (const endpoint of endpointList) {
      const dx = parking.x - endpoint.x;
      const dy = parking.y - endpoint.y;
      const dz = parking.z - endpoint.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxMetersSq) continue;
      const bridgeMeters = Math.sqrt(d2);
      if (
        !bestEndpoint ||
        endpoint.jumps < bestEndpoint.jumps ||
        (endpoint.jumps === bestEndpoint.jumps && bridgeMeters < bestEndpoint.bridgeMeters)
      ) {
        bestEndpoint = { id: endpoint.id, jumps: endpoint.jumps, bridgeMeters };
      }
    }
    if (!bestEndpoint) continue;
    bridgeInfoByParking.set(parking.id, { endpointId: bestEndpoint.id, destinationJumps: bestEndpoint.jumps, bridgeMeters: bestEndpoint.bridgeMeters });
    bridgeSources.push({ parkingId: parking.id, endpointId: bestEndpoint.id, baseCost: bestEndpoint.jumps });
  }

  if (bridgeSources.length === 0) {
    return { routes: [], message: 'No reachable second-bridge parking systems found.', baselineJumps };
  }

  const { dist: oneBridgeDist, prev: oneBridgePrev, sourceParking, sourceEndpoint } = computeBestOneBridgeCosts(bridgeSources, payload.settings);
  const endpoint1List: Array<{ id: number; x: number; y: number; z: number; cost: number }> = [];
  for (const sys of systemsList) {
    const cost = oneBridgeDist.get(sys.id);
    if (cost == null) continue;
    endpoint1List.push({ id: sys.id, x: sys.x, y: sys.y, z: sys.z, cost });
  }

  if (endpoint1List.length === 0) {
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
      payload.destinationId
    );
    onPartial(routes, baselineJumps);
  };

  for (const parking of systemsList) {
    if (payload.settings.bridgeFromStaging && parking.id !== payload.stagingId) continue;
    if (payload.settings.excludeZarzakh && parking.id === 30100000) continue;
    if (isForbiddenSystem(parking)) continue;
    const stagingJumps = stagingDist.get(parking.id);
    if (stagingJumps == null) continue;
    let bestEndpoint: { id: number; cost: number; bridgeMeters: number } | null = null;
    for (const endpoint of endpoint1List) {
      const dx = parking.x - endpoint.x;
      const dy = parking.y - endpoint.y;
      const dz = parking.z - endpoint.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxMetersSq) continue;
      const bridgeMeters = Math.sqrt(d2);
      const totalCost = stagingJumps + endpoint.cost;
      if (
        !bestEndpoint ||
        totalCost < stagingJumps + bestEndpoint.cost ||
        (totalCost === stagingJumps + bestEndpoint.cost && bridgeMeters < bestEndpoint.bridgeMeters)
      ) {
        bestEndpoint = { id: endpoint.id, cost: endpoint.cost, bridgeMeters };
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
      bridgeMeters: bestEndpoint.bridgeMeters,
      bridge2Meters: bridgeInfo.bridgeMeters,
      totalJumps,
    };
    const changed = insertCandidate(bestTwo, cand, limit, compareTwoBridgeCandidates);
    if (changed) {
      emitTwo(bestTwo.length === 1);
    }
  }

  if (bestTwo.length === 0) {
    return { routes: [], message: 'No reachable two-bridge routes found.', baselineJumps };
  }

  const routes = buildRoutesFromTwoBridgeCandidates(
    bestTwo,
    stagingPrev,
    destinationPrev,
    oneBridgePrev,
    payload.stagingId,
    payload.destinationId
  );
  if (routes.length === 0) {
    return { routes: [], message: 'No routes found.', baselineJumps };
  }

  return { routes, message: null, baselineJumps };
}

self.onmessage = (event: MessageEvent<InitRequest | ComputeRequest>) => {
  const data = event.data;
  if (data.type === 'init') {
    graph = data.graph;
    buildSystemsList(data.graph);
    return;
  }
  if (data.type === 'compute') {
    const result = computeRoutes(data, (routes, baselineJumps) => {
      (self as any).postMessage({ type: 'partial', requestId: data.requestId, routes, message: null, baselineJumps });
    });
    (self as any).postMessage({ type: 'result', requestId: data.requestId, ...result });
  }
};

export {};
