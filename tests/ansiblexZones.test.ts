import { describe, expect, it } from 'vitest';
import catalog from '../public/data/ansiblex_rules.json';
import {
  ansiblexZoneSummary, emptyAnsiblexPlanner, exportAnsiblexPlan, filterAnsiblexEdges,
  getAnsiblexRouteZones, importAnsiblexPlan, METERS_PER_LY, normalizeAnsiblexPlanner,
  resolveAnsiblexEdges, type AnsiblexZone, type PositionedGraph, type SovereigntySnapshot,
} from '../src/lib/ansiblex';
import {
  classifyAnsiblexSystems, getAnsiblexZoneBounds, getAnsiblexZoneGeometry,
  groupAnsiblexZoneCells, zoneRangeLabel,
} from '../src/lib/ansiblexZones';
import { computeTravelTree, initializeRouteGraph } from '../src/workers/bridgePlannerWorker';

function graphAt(points: Array<[number, number, number]>) {
  return { systems: Object.fromEntries(points.map(([x, y, z], index) => [index + 1, {
    systemId: index + 1, regionId: 1, security: 0, adjacentSystems: [] as number[],
    position: { x: x * METERS_PER_LY, y: y * METERS_PER_LY, z: z * METERS_PER_LY },
  }])) };
}
const now = 1000;
const graph = graphAt([[0, 0, 0], [5, 0, 0], [10, 0, 0], [15, 0, 0], [20, 0, 0], [25, 0, 0]]);
const snapshot: SovereigntySnapshot = { fetchedAt: now, expiresAt: now + 300_000,
  owners: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 }, capitals: { 10: 1 } };
function resolve(data: PositionedGraph = graph) {
  const planner = emptyAnsiblexPlanner();
  planner.endpoints = Object.fromEntries([1, 2, 3, 4, 5, 6].map((id) => [id, { ownerAllianceId: 10 }]));
  const links = [2, 3, 4, 5, 6].map((to) => ({ from: 1, to, bidirectional: true }));
  return resolveAnsiblexEdges(links, planner, 10, snapshot, data, catalog, now);
}

describe('destination zone routing', () => {
  it.each([1, 2, 3, 4, 5] as AnsiblexZone[])('limits outward arrivals at Zone %i and retains every return to the capital', (maximum) => {
    const edges = filterAnsiblexEdges(resolve(), maximum);
    expect(edges.filter((edge) => edge.from === 1).map((edge) => edge.to)).toEqual([2, 3, 4, 5, 6].slice(0, maximum));
    expect(edges.filter((edge) => edge.to === 1)).toHaveLength(5);
  });
  it.each([5, 10, 15, 20])('classifies both sides of the exact %i LY boundary before filtering', (boundary) => {
    const data = graphAt([[0, 0, 0], [boundary, 0, 0], [boundary + 1e-6, 0, 0], [boundary - 1e-6, 0, 0]]);
    const edges = resolve(data);
    const maxZone = boundary / 5 as AnsiblexZone;
    expect(filterAnsiblexEdges(edges, maxZone).filter((edge) => edge.from === 1).map((edge) => edge.to)).toEqual([2, 4]);
  });
  it('keeps unknown destinations only when all zones are allowed', () => {
    const edges = resolve(graphAt([[0, 0, 0]]));
    expect(edges.find((edge) => edge.from === 1)?.zone).toBeNull();
    for (const maximum of [1, 2, 3, 4] as AnsiblexZone[]) {
      expect(filterAnsiblexEdges(edges, maximum).some((edge) => edge.from === 1)).toBe(false);
    }
    expect(filterAnsiblexEdges(edges, 5)).toHaveLength(edges.length);
  });
  it('uses each departure owner’s capital, independently of the displayed alliance', () => {
    const planner = emptyAnsiblexPlanner();
    const edges = resolveAnsiblexEdges([{ from: 2, to: 5 }], planner, null,
      { ...snapshot, owners: { 2: 10, 5: 20 }, capitals: { 10: 1, 20: 6 } }, graph, catalog, now);
    expect(edges.map((edge) => [edge.from, edge.capitalId, edge.zone])).toEqual([[2, 1, 4], [5, 6, 4]]);
    planner.capitalOverrides[20] = 2;
    const overridden = resolveAnsiblexEdges([{ from: 2, to: 5 }], planner, null,
      { ...snapshot, owners: { 2: 10, 5: 20 }, capitals: { 10: 1, 20: 6 } }, graph, catalog, now);
    expect(filterAnsiblexEdges(overridden, 1).map((edge) => [edge.from, edge.to])).toEqual([[5, 2]]);
  });
  it('never restores a known ownership restriction at any ceiling', () => {
    const planner = emptyAnsiblexPlanner();
    planner.endpoints[1] = { ownerAllianceId: 20 };
    const edges = resolveAnsiblexEdges([{ from: 1, to: 2 }], planner, 10, snapshot, graph, catalog, now);
    for (const maximum of [1, 2, 3, 4, 5] as AnsiblexZone[]) {
      expect(filterAnsiblexEdges(edges, maximum).some((edge) => edge.from === 1)).toBe(false);
    }
  });
  it('updates forward and destination worker caches when the ceiling changes', () => {
    initializeRouteGraph(graph);
    const settings = (maxZone: AnsiblexZone) => ({ allowAnsiblex: true, ansiblexes: filterAnsiblexEdges(resolve(), maxZone) });
    expect(computeTravelTree(1, settings(5), 200).dist.has(6)).toBe(true);
    expect(computeTravelTree(1, settings(1), 200).dist.has(6)).toBe(false);
    expect(computeTravelTree(6, settings(1), 200).dist.has(1)).toBe(true);
    expect(computeTravelTree(6, settings(1), 200, true).dist.has(1)).toBe(false);
    expect(computeTravelTree(6, settings(5), 200, true).dist.has(1)).toBe(true);
  });
  it('works without a fleet and keeps capacitor warnings out of route summaries', () => {
    const edges = resolve();
    expect(edges.every((edge) => !edge.blocked)).toBe(true);
    const summary = getAnsiblexRouteZones([{ kind: 'ansiblex', fromId: 1, toId: 3 }, { kind: 'stargate', fromId: 3, toId: 4 }], edges);
    expect(summary).toEqual({ count: 1, zones: [2], unknownZone: false });
    expect(ansiblexZoneSummary(summary)).toBe('1 Ansiblex · Zone 2');
    expect(ansiblexZoneSummary(getAnsiblexRouteZones([{ kind: 'ansiblex', fromId: 1, toId: 3 }], [])))
      .toBe('1 Ansiblex · zone unknown');
  });
});

describe('zone preferences', () => {
  it('defaults new and older settings/exports to all zones with the overlay shown', () => {
    expect(emptyAnsiblexPlanner()).toMatchObject({ maxZone: 5, showZoneOverlay: true });
    expect(normalizeAnsiblexPlanner({ fleet: [], endpoints: {} })).toMatchObject({ maxZone: 5, showZoneOverlay: true });
    const imported = importAnsiblexPlan(JSON.stringify({ format: 'backroads-ansiblex', version: 1, links: [], planner: { fleet: [] } }));
    expect(imported.planner).toMatchObject({ maxZone: 5, showZoneOverlay: true });
    expect(importAnsiblexPlan('[{"from":1,"to":2}]').planner).toBeUndefined();
  });
  it('round trips the ceiling and overlay visibility separately', () => {
    const planner = { ...emptyAnsiblexPlanner(), maxZone: 3 as const, showZoneOverlay: false };
    expect(importAnsiblexPlan(exportAnsiblexPlan([], planner)).planner).toEqual(planner);
    expect(normalizeAnsiblexPlanner(JSON.parse(JSON.stringify(planner)))).toEqual(planner);
  });
  it.each([[0, 1], [6, 5], [3.7, 3], [NaN, 5], [null, 5], ['2', 5]])('normalizes a saved ceiling %s to %i', (input, expected) => {
    expect(normalizeAnsiblexPlanner({ maxZone: input }).maxZone).toBe(expected);
  });
});

describe('zone map geometry', () => {
  const data = graphAt([[0, 0, 0], [4, 12, 0], [-4, 0, 1], [1, 0, 6], [12, 0, 14], [25, 0, 2]]);
  it('classifies using all three coordinates, independent of the flattened map', () => {
    const zones = classifyAnsiblexSystems(data, 1, catalog);
    expect(zones.get(1)).toEqual({ zone: 1, distanceLy: 0 });
    expect(zones.get(2)).toEqual({ zone: 3, distanceLy: Math.hypot(4, 12) });
    expect(zones.get(3)?.zone).toBe(1);
    expect([...zones.values()].map((item) => item.zone)).toEqual([1, 3, 1, 2, 4, 5]);
  });
  it('creates closed bounded cells that partition the projected area', () => {
    const geometry = getAnsiblexZoneGeometry(data);
    const [x0, y0, x1, y1] = geometry.boundsLy;
    expect(geometry.cells).toHaveLength(6);
    let totalArea = 0;
    for (const { polygon } of geometry.cells) {
      expect(polygon[0]).toEqual(polygon[polygon.length - 1]);
      let twiceArea = 0;
      for (let index = 0; index < polygon.length - 1; index++) {
        const [x, y] = polygon[index]; const [nx, ny] = polygon[index + 1];
        expect(x).toBeGreaterThanOrEqual(x0); expect(x).toBeLessThanOrEqual(x1);
        expect(y).toBeGreaterThanOrEqual(y0); expect(y).toBeLessThanOrEqual(y1);
        twiceArea += x * ny - nx * y;
      }
      totalArea += Math.abs(twiceArea) / 2;
    }
    expect(totalArea).toBeCloseTo((x1 - x0) * (y1 - y0), 6);
  });
  it('reuses geometry when the capital changes while regrouping zones', () => {
    const geometry = getAnsiblexZoneGeometry(data);
    const groups = groupAnsiblexZoneCells(geometry, classifyAnsiblexSystems(data, 1, catalog));
    expect(groups.get(1)?.map((cell) => cell.systemId)).toEqual([1, 3]);
    const newGroups = groupAnsiblexZoneCells(geometry, classifyAnsiblexSystems(data, 6, catalog));
    expect(newGroups.get(1)?.map((cell) => cell.systemId)).toEqual([6]);
    expect(getAnsiblexZoneGeometry(data)).toBe(geometry);
    expect(getAnsiblexZoneGeometry(graphAt([[1, 0, 1]]))).not.toBe(geometry);
  });
  it('handles collinear or coincident projected points without invalid polygons', () => {
    const collinear = graphAt([[0, 0, 0], [1, 0, 0], [1, 12, 0], [2, 0, 0]]);
    const geometry = getAnsiblexZoneGeometry(collinear);
    expect(geometry.cells.length).toBeGreaterThanOrEqual(3);
    expect(geometry.cells.flatMap((cell) => cell.polygon.flat()).every(Number.isFinite)).toBe(true);
    expect(classifyAnsiblexSystems(collinear, 1, catalog).get(3)?.zone).toBe(3);
  });
  it('frames the actual capital with a 25 LY margin and never assumes an unknown capital', () => {
    const bounds = getAnsiblexZoneBounds(data, 4)!;
    expect(bounds.minX / METERS_PER_LY).toBe(-24);
    expect(bounds.maxX / METERS_PER_LY).toBe(26);
    expect(bounds.minY / METERS_PER_LY).toBe(-31);
    expect(bounds.maxY / METERS_PER_LY).toBe(19);
    expect(getAnsiblexZoneBounds(data, 999)).toBeNull();
    expect(classifyAnsiblexSystems(data, null, catalog).size).toBe(0);
    expect(getAnsiblexZoneGeometry({ systems: {} }).cells).toEqual([]);
  });
  it('labels continuous distance bands consistently with classification', () => {
    expect(([1, 2, 3, 4, 5] as AnsiblexZone[]).map((zone) => zoneRangeLabel(zone, catalog)))
      .toEqual(['0–5 LY', '>5–10 LY', '>10–15 LY', '>15–20 LY', '>20 LY']);
  });
});
