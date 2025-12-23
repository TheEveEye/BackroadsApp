type SystemNode = {
  systemId: number;
  regionId: number;
  position: { x: number; y: number; z: number };
  adjacentSystems: number[];
};

type GraphData = {
  systems: Record<string, SystemNode>;
};

type AnsiblexBridge = { from: number; to: number; enabled?: boolean; bidirectional?: boolean };
type TravelSettings = {
  excludeZarzakh?: boolean;
  sameRegionOnly?: boolean;
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
};

type Candidate = {
  parkingId: number;
  endpointId: number;
  stagingJumps: number;
  destinationJumps: number;
  bridgeMeters: number;
  totalJumps: number;
};

const LY = 9.4607e15;
const MAX_TRAVEL_JUMPS = 200;

let graph: GraphData | null = null;
let systemsList: Array<{ id: number; x: number; y: number; z: number; regionId: number; adjacentSystems: number[] }> = [];

function buildSystemsList(data: GraphData) {
  const list: Array<{ id: number; x: number; y: number; z: number; regionId: number; adjacentSystems: number[] }> = [];
  for (const [idStr, sys] of Object.entries(data.systems)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    list.push({
      id,
      x: sys.position.x,
      y: sys.position.y,
      z: sys.position.z,
      regionId: sys.regionId,
      adjacentSystems: sys.adjacentSystems || [],
    });
  }
  systemsList = list;
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

function compareCandidates(a: Candidate, b: Candidate) {
  if (a.totalJumps !== b.totalJumps) return a.totalJumps - b.totalJumps;
  if (a.stagingJumps !== b.stagingJumps) return a.stagingJumps - b.stagingJumps;
  if (a.destinationJumps !== b.destinationJumps) return a.destinationJumps - b.destinationJumps;
  return a.bridgeMeters - b.bridgeMeters;
}

function insertCandidate(best: Candidate[], cand: Candidate, limit: number) {
  const idx = best.findIndex((b) => compareCandidates(cand, b) < 0);
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

function computeRoutes(
  payload: ComputeRequest,
  onPartial?: (routes: RouteOption[], baselineJumps: number | null) => void
): { routes: RouteOption[]; message: string | null; baselineJumps: number | null } {
  if (!graph) return { routes: [], message: 'Graph not loaded.', baselineJumps: null };
  const systems = graph.systems;
  if (!systems[String(payload.destinationId)]) return { routes: [], message: 'Destination system not found.', baselineJumps: null };
  if (!systems[String(payload.stagingId)]) return { routes: [], message: 'Staging system not found.', baselineJumps: null };

  const maxMeters = payload.bridgeRange * LY;
  const maxMetersSq = maxMeters * maxMeters;

  const { dist: stagingDist, prev: stagingPrev } = computeTravelTree(payload.stagingId, payload.settings, MAX_TRAVEL_JUMPS);
  const { dist: destinationDist, prev: destinationPrev } = computeTravelTree(payload.destinationId, payload.settings, MAX_TRAVEL_JUMPS);

  const baselineJumps = stagingDist.get(payload.destinationId) ?? null;

  const endpointList: Array<{ id: number; x: number; y: number; z: number; jumps: number }> = [];
  for (const sys of systemsList) {
    const jumps = destinationDist.get(sys.id);
    if (jumps == null) continue;
    endpointList.push({ id: sys.id, x: sys.x, y: sys.y, z: sys.z, jumps });
  }

  if (endpointList.length === 0) {
    return { routes: [], message: 'No destination routes found.', baselineJumps };
  }

  const limit = Math.max(1, Math.min(25, payload.routesToShow || 5));
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
    if (payload.settings.excludeZarzakh && parking.id === 30100000) continue;
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
    const changed = insertCandidate(best, cand, limit);
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
