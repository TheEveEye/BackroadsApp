import type { GraphData, SystemNode } from '../../lib/data';

export const LY_IN_METERS = 9.4607e15;

export type ProjectedPoint = { px: number; py: number };
export type MapBounds = { minX: number; maxX: number; minY: number; maxY: number };

type AnsiblexLink = {
  from: number;
  to: number;
  enabled?: boolean;
  bidirectional?: boolean;
};

export function project2D(x: number, _y: number, z: number): ProjectedPoint {
  return { px: x, py: -z };
}

export function projectSystem(system: Pick<SystemNode, 'position'> | null | undefined): ProjectedPoint | null {
  if (!system) return null;
  return project2D(system.position.x, system.position.y, system.position.z);
}

export function buildProjectedSystemMap(graph: GraphData | null | undefined): Map<number, ProjectedPoint> {
  const projected = new Map<number, ProjectedPoint>();
  if (!graph) return projected;
  for (const [idStr, system] of Object.entries(graph.systems)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    projected.set(id, project2D(system.position.x, system.position.y, system.position.z));
  }
  return projected;
}

export function boundsFromIds(graph: GraphData | null | undefined, ids: readonly number[] | null | undefined): MapBounds | null {
  if (!graph || !ids || ids.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const projected = projectSystem(graph.systems[String(id)]);
    if (!projected) continue;
    minX = Math.min(minX, projected.px);
    maxX = Math.max(maxX, projected.px);
    minY = Math.min(minY, projected.py);
    maxY = Math.max(maxY, projected.py);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

export function fitBoundsScale(bounds: MapBounds | null, width: number, height: number, pad: number): number {
  if (!bounds) return 1;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (spanX === 0 && spanY === 0) return 1;
  if (spanX === 0) return (height - pad * 2) / spanY;
  if (spanY === 0) return (width - pad * 2) / spanX;
  return Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
}

export function centerFromBounds(bounds: MapBounds | null): { cx: number; cy: number } {
  if (!bounds) return { cx: 0, cy: 0 };
  return {
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
  };
}

export function fitRadiusScale(points: readonly ProjectedPoint[], center: ProjectedPoint, width: number, height: number, pad: number, minWorldRadius = 0): number {
  if (points.length === 0) return 1;
  let maxDistance = 0;
  for (const point of points) {
    const distance = Math.hypot(point.px - center.px, point.py - center.py);
    if (distance > maxDistance) maxDistance = distance;
  }
  const radiusPx = Math.max(1, Math.min(width, height) / 2 - pad);
  const worldRadius = Math.max(maxDistance, minWorldRadius);
  return worldRadius > 0 ? radiusPx / worldRadius : 1;
}

export function segmentIntersectsRect(x1: number, y1: number, x2: number, y2: number, xMin: number, yMin: number, xMax: number, yMax: number): boolean {
  const LEFT = 1;
  const RIGHT = 2;
  const BOTTOM = 4;
  const TOP = 8;
  const code = (x: number, y: number) =>
    ((x < xMin ? LEFT : 0) |
      (x > xMax ? RIGHT : 0) |
      (y < yMin ? BOTTOM : 0) |
      (y > yMax ? TOP : 0));
  let c1 = code(x1, y1);
  let c2 = code(x2, y2);
  while (true) {
    if ((c1 | c2) === 0) return true;
    if ((c1 & c2) !== 0) return false;
    const co = c1 ? c1 : c2;
    let x = 0;
    let y = 0;
    if (co & TOP) {
      x = x1 + (x2 - x1) * (yMax - y1) / (y2 - y1);
      y = yMax;
    } else if (co & BOTTOM) {
      x = x1 + (x2 - x1) * (yMin - y1) / (y2 - y1);
      y = yMin;
    } else if (co & RIGHT) {
      y = y1 + (y2 - y1) * (xMax - x1) / (x2 - x1);
      x = xMax;
    } else {
      y = y1 + (y2 - y1) * (xMin - x1) / (x2 - x1);
      x = xMin;
    }
    if (co === c1) {
      x1 = x;
      y1 = y;
      c1 = code(x1, y1);
    } else {
      x2 = x;
      y2 = y;
      c2 = code(x2, y2);
    }
  }
}

export function buildArcPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ampScale = 0.22,
  minAmp = 28,
  maxAmp = 140,
): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (Math.abs(ny) < 1e-6) {
    nx = 0;
    ny = -1;
  } else if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const amp = Math.min(maxAmp, Math.max(minAmp, len * ampScale));
  const cxp = mx + nx * amp;
  const cyp = my + ny * amp;
  return `M ${from.x} ${from.y} Q ${cxp} ${cyp} ${to.x} ${to.y}`;
}

export function buildAnsiblexSet(
  allowAnsiblex: boolean | undefined,
  ansiblexes: readonly AnsiblexLink[] | null | undefined,
  options?: { defaultBidirectional?: boolean },
): Set<string> {
  const set = new Set<string>();
  if (!allowAnsiblex || !Array.isArray(ansiblexes)) return set;
  const defaultBidirectional = options?.defaultBidirectional ?? true;
  for (const bridge of ansiblexes) {
    if (!bridge || bridge.enabled === false) continue;
    const from = Number(bridge.from);
    const to = Number(bridge.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    set.add(`${from}->${to}`);
    if ((bridge.bidirectional ?? defaultBidirectional) !== false) {
      set.add(`${to}->${from}`);
    }
  }
  return set;
}
