import type { GraphData } from './data';

export type ObservatoryHit = {
  systemId: number;
  distance: number;
  path: number[];
};

export type FinderSettings = { excludeZarzakh?: boolean; sameRegionOnly?: boolean; titanBridgeFirstJump?: boolean };

const LY = 9.4607e15; // meters per lightyear

function computeBridgeTargets({ graph, startId, lyRadius, sameRegionOnly, excludeIds }: { graph: GraphData; startId: number; lyRadius: number; sameRegionOnly: boolean; excludeIds: Set<number> }) {
  const systems = graph.systems;
  const start = systems[String(startId)];
  if (!start) return [] as number[];
  const startRegion = start.regionId;
  const out: number[] = [];
  const maxMeters = lyRadius * LY;
  for (const [idStr, sys] of Object.entries(systems)) {
    const id = Number(idStr);
    if (id === startId) continue;
    if (excludeIds.has(id)) continue;
    if (sameRegionOnly && sys.regionId !== startRegion) continue;
    const d = Math.hypot(start.position.x - sys.position.x, start.position.y - sys.position.y, start.position.z - sys.position.z);
    if (d <= maxMeters) out.push(id);
  }
  return out;
}

export function bfsObservatories({ startId, maxJumps, graph, settings, lyRadius }: { startId: number; maxJumps: number; graph: GraphData; settings?: FinderSettings; lyRadius: number }): ObservatoryHit[] {
  const systems = graph.systems;
  const start = systems[String(startId)];
  if (!start) return [];

  const exclude = new Set<number>();
  if (settings?.excludeZarzakh) exclude.add(30100000);
  const sameRegionOnly = !!settings?.sameRegionOnly;
  const startRegion = start.regionId;

  const queue: { id: number; dist: number; path: number[] }[] = [{ id: startId, dist: 0, path: [startId] }];
  const visited = new Set<number>([startId]);
  const hits: Map<number, ObservatoryHit> = new Map();

  const startAdj = new Set<number>(start.adjacentSystems);
  const allowTitan = !!settings?.titanBridgeFirstJump && lyRadius > 0;
  const titanTargets = allowTitan ? computeBridgeTargets({ graph, startId, lyRadius, sameRegionOnly, excludeIds: exclude }) : [];

  while (queue.length) {
    const { id, dist, path } = queue.shift()!;
    const node = systems[String(id)];
    if (!node) continue;
    if (exclude.has(id)) continue;
    if (sameRegionOnly && node.regionId !== startRegion) continue;

    if (node.hasObservatory) {
      const existing = hits.get(id);
      if (!existing || dist < existing.distance) {
        hits.set(id, { systemId: id, distance: dist, path });
      }
    }

    if (dist >= maxJumps) continue;

    // neighbors: gate edges
    for (const next of node.adjacentSystems) {
      if (exclude.has(next)) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ id: next, dist: dist + 1, path: [...path, next] });
    }

    // titan bridge from start counts as first jump only when expanding from start at dist 0
    if (allowTitan && id === startId && dist === 0) {
      for (const next of titanTargets) {
        if (startAdj.has(next)) continue; // already covered by gate edge
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push({ id: next, dist: 1, path: [...path, next] });
      }
    }
  }

  return Array.from(hits.values()).sort((a, b) => a.distance - b.distance || a.systemId - b.systemId);
}

export function resolveQueryToId(query: string, graph: GraphData): number | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  // name lookup
  const byName = graph.idsByName;
  if (byName) {
    const id = byName[trimmed.toLowerCase()];
    if (typeof id === 'number') return id;
  }
  return null;
}


export type FrontierNode = { id: number; dist: number };
export type ExploreResult = {
  nodes: FrontierNode[];
  edges: Array<[number, number]>; // pairs of system IDs (u->v within explored frontier)
  maxDist: number;
};

// Explore graph up to maxJumps (BFS) returning frontier nodes and connecting edges.
export function exploreFrontier({ startId, maxJumps, graph, settings, lyRadius }: { startId: number; maxJumps: number; graph: GraphData; settings?: FinderSettings; lyRadius: number }): ExploreResult {
  const systems = graph.systems;
  const start = systems[String(startId)];
  if (!start) return { nodes: [], edges: [], maxDist: 0 };

  const exclude = new Set<number>();
  if (settings?.excludeZarzakh) exclude.add(30100000);
  const sameRegionOnly = !!settings?.sameRegionOnly;
  const startRegion = start.regionId;

  const queue: { id: number; dist: number }[] = [{ id: startId, dist: 0 }];
  const visited = new Set<number>([startId]);
  const nodes: FrontierNode[] = [];
  const edges: Array<[number, number]> = [];
  let maxDist = 0;

  const allowTitan = !!settings?.titanBridgeFirstJump && lyRadius > 0;
  const startAdj = new Set<number>(start.adjacentSystems);
  const titanTargets = allowTitan ? computeBridgeTargets({ graph, startId, lyRadius, sameRegionOnly, excludeIds: exclude }) : [];

  while (queue.length) {
    const { id, dist } = queue.shift()!;
    const cur = systems[String(id)];
    if (!cur) continue;
    if (exclude.has(id)) continue;
    if (sameRegionOnly && cur.regionId !== startRegion) continue;

    nodes.push({ id, dist });
    maxDist = Math.max(maxDist, dist);
    if (dist >= maxJumps) continue;

    for (const next of cur.adjacentSystems) {
      if (exclude.has(next)) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
      edges.push([id, next]);
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, dist: dist + 1 });
      }
    }

    // also enqueue titan bridge from start as first jump
    if (allowTitan && id === startId && dist === 0) {
      for (const next of titanTargets) {
        if (startAdj.has(next)) continue;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, dist: 1 });
        }
      }
    }
  }

  return { nodes, edges, maxDist };
}

// Find shortest path to a specific target with the same exploration rules, including optional titan bridge as first jump.
export function findPathTo({ startId, targetId, maxJumps, graph, settings, lyRadius }: { startId: number; targetId: number; maxJumps: number; graph: GraphData; settings?: FinderSettings; lyRadius: number }): { path: number[] | null; usedTitan: boolean } {
  const systems = graph.systems;
  const start = systems[String(startId)];
  const target = systems[String(targetId)];
  if (!start || !target) return { path: null, usedTitan: false };

  const exclude = new Set<number>();
  if (settings?.excludeZarzakh) exclude.add(30100000);
  const sameRegionOnly = !!settings?.sameRegionOnly;
  const startRegion = start.regionId;

  const allowTitan = !!settings?.titanBridgeFirstJump && lyRadius > 0;
  const startAdj = new Set<number>(start.adjacentSystems);
  const titanTargets = allowTitan ? computeBridgeTargets({ graph, startId, lyRadius, sameRegionOnly, excludeIds: exclude }) : [];

  const queue: { id: number; dist: number; path: number[] }[] = [{ id: startId, dist: 0, path: [startId] }];
  const visited = new Set<number>([startId]);

  while (queue.length) {
    const { id, dist, path } = queue.shift()!;
    const node = systems[String(id)];
    if (!node) continue;
    if (exclude.has(id)) continue;
    if (sameRegionOnly && node.regionId !== startRegion) continue;
    if (id === targetId) {
      const usedTitan = path.length >= 2 && !startAdj.has(path[1]);
      return { path, usedTitan };
    }
    if (dist >= maxJumps) continue;

    for (const next of node.adjacentSystems) {
      if (exclude.has(next)) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, dist: dist + 1, path: [...path, next] });
      }
    }

    if (allowTitan && id === startId && dist === 0) {
      for (const next of titanTargets) {
        if (startAdj.has(next)) continue;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, dist: 1, path: [...path, next] });
        }
      }
    }
  }

  return { path: null, usedTitan: false };
}
