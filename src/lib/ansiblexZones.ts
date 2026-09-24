import { Delaunay } from 'd3-delaunay';
import { getAnsiblexZone, METERS_PER_LY, type AnsiblexRules, type AnsiblexZone, type PositionedGraph } from './ansiblex';
import type { MapBounds } from '../components/map/shared';

export const ANSIBLEX_ZONE_COLORS: Record<AnsiblexZone, string> = {
  1: '#22c55e', 2: '#14b8a6', 3: '#3b82f6', 4: '#8b5cf6', 5: '#d946ef',
};
export const ANSIBLEX_ZONES: readonly AnsiblexZone[] = [1, 2, 3, 4, 5];
export const ZONE_VIEW_MARGIN_LY = 25;
const CELL_BOUNDS_PADDING_LY = 5;

export type SystemZone = { zone: AnsiblexZone; distanceLy: number };
export type ZoneCell = { systemId: number; polygon: Array<[number, number]> };
export type ZoneGeometry = { cells: ZoneCell[]; boundsLy: [number, number, number, number] };
export type AnsiblexZoneOverlay = {
  visible: boolean;
  capitalId: number | null;
  allianceName: string | null;
  referenceLabel?: string;
  rules: AnsiblexRules | null;
  maxZone: AnsiblexZone;
};

const geometryCache = new WeakMap<PositionedGraph, ZoneGeometry>();

function validPosition(position: { x: number; y: number; z: number }) {
  return [position.x, position.y, position.z].every(Number.isFinite);
}

/** Geometry depends only on the graph. Use LY coordinates for numerical stability. */
export function getAnsiblexZoneGeometry(graph: PositionedGraph): ZoneGeometry {
  const cached = geometryCache.get(graph);
  if (cached) return cached;
  const systems = Object.entries(graph.systems)
    .filter(([, system]) => validPosition(system.position))
    .map(([id, system]) => ({ id: Number(id), x: system.position.x / METERS_PER_LY, y: -system.position.z / METERS_PER_LY }))
    .sort((a, b) => a.id - b.id);
  if (!systems.length) {
    const geometry: ZoneGeometry = { cells: [], boundsLy: [-1, -1, 1, 1] };
    geometryCache.set(graph, geometry);
    return geometry;
  }
  const boundsLy: [number, number, number, number] = [
    Math.min(...systems.map((system) => system.x)) - CELL_BOUNDS_PADDING_LY,
    Math.min(...systems.map((system) => system.y)) - CELL_BOUNDS_PADDING_LY,
    Math.max(...systems.map((system) => system.x)) + CELL_BOUNDS_PADDING_LY,
    Math.max(...systems.map((system) => system.y)) + CELL_BOUNDS_PADDING_LY,
  ];
  const delaunay = Delaunay.from(systems, (system) => system.x, (system) => system.y);
  const voronoi = delaunay.voronoi(boundsLy);
  const cells: ZoneCell[] = [];
  for (let index = 0; index < systems.length; index++) {
    const polygon = voronoi.cellPolygon(index);
    // Coincident projected systems share a cell; d3 returns null for duplicates.
    if (polygon?.length) cells.push({ systemId: systems[index].id, polygon });
  }
  const geometry = { cells, boundsLy };
  geometryCache.set(graph, geometry);
  return geometry;
}

export function classifyAnsiblexSystems(graph: PositionedGraph, capitalId: number | null, rules: AnsiblexRules): Map<number, SystemZone> {
  const result = new Map<number, SystemZone>();
  const capital = capitalId == null ? null : graph.systems[String(capitalId)]?.position;
  if (!capital || !validPosition(capital)) return result;
  for (const [id, system] of Object.entries(graph.systems)) {
    const position = system.position;
    if (!validPosition(position)) continue;
    const distanceLy = Math.hypot(position.x - capital.x, position.y - capital.y, position.z - capital.z) / METERS_PER_LY;
    const zone = getAnsiblexZone(distanceLy, rules);
    if (zone) result.set(Number(id), { zone: zone.zone as AnsiblexZone, distanceLy });
  }
  return result;
}

export function groupAnsiblexZoneCells(geometry: ZoneGeometry, zones: ReadonlyMap<number, SystemZone>) {
  const groups = new Map<AnsiblexZone, ZoneCell[]>();
  for (const cell of geometry.cells) {
    const zone = zones.get(cell.systemId)?.zone;
    if (zone == null) continue;
    const group = groups.get(zone) ?? [];
    group.push(cell);
    groups.set(zone, group);
  }
  return groups;
}

export function getAnsiblexZoneBounds(graph: PositionedGraph | null, capitalId: number | null): MapBounds | null {
  const capital = capitalId == null ? null : graph?.systems[String(capitalId)]?.position;
  if (!capital || !validPosition(capital)) return null;
  const margin = ZONE_VIEW_MARGIN_LY * METERS_PER_LY;
  return { minX: capital.x - margin, maxX: capital.x + margin, minY: -capital.z - margin, maxY: -capital.z + margin };
}

export function zoneRangeLabel(zone: AnsiblexZone, rules: AnsiblexRules): string {
  const previous = zone > 1 ? rules.zones[zone - 2]?.maxLy ?? 0 : 0;
  const maximum = rules.zones[zone - 1]?.maxLy;
  return maximum == null ? `>${previous} LY` : `${zone === 1 ? '' : '>'}${previous}–${maximum} LY`;
}
