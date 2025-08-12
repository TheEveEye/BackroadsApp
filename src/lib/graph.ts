import type { GraphData } from './data';

export type ObservatoryHit = {
  systemId: number;
  distance: number;
  path: number[];
};

export type FinderSettings = { excludeZarzakh?: boolean; sameRegionOnly?: boolean };

export function bfsObservatories({ startId, maxJumps, graph, settings }: { startId: number; maxJumps: number; graph: GraphData; settings?: FinderSettings }): ObservatoryHit[] {
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

    for (const next of node.adjacentSystems) {
      if (exclude.has(next)) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ id: next, dist: dist + 1, path: [...path, next] });
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
export function exploreFrontier({ startId, maxJumps, graph, settings }: { startId: number; maxJumps: number; graph: GraphData; settings?: FinderSettings }): ExploreResult {
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
  }

  return { nodes, edges, maxDist };
}
