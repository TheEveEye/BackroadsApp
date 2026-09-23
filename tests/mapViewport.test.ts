import { describe, expect, it } from 'vitest';
import { centerFromBounds, fitBoundsScale, rebaseMapViewport, type MapBounds, type MapViewport } from '../src/components/map/shared';

const width = 800;
const height = 600;
const pad = 70;
const zoneBounds: MapBounds = { minX: -2e17, maxX: 2e17, minY: -1e17, maxY: 3e17 };
const routeBounds: MapBounds = { minX: 1e17, maxX: 1.5e17, minY: -1e16, maxY: 2e16 };
const viewport: MapViewport = { zoom: 1.75, pan: { x: 120, y: -85 } };

function screenPoint(bounds: MapBounds, view: MapViewport, x: number, y: number) {
  const center = centerFromBounds(bounds);
  const scale = fitBoundsScale(bounds, width, height, pad) * view.zoom;
  return { x: width / 2 + (x - center.cx) * scale + view.pan.x,
    y: height / 2 + (y - center.cy) * scale + view.pan.y };
}

describe('animated map reframing', () => {
  it('preserves the visible transform when fitting the existing frame', () => {
    expect(rebaseMapViewport(viewport, zoneBounds, zoneBounds, width, height, pad)).toEqual(viewport);
  });

  it.each([
    ['zones to route', zoneBounds, routeBounds],
    ['route to zones', routeBounds, zoneBounds],
  ] as const)('avoids an initial snap when fitting %s', (_label, from, to) => {
    const rebased = rebaseMapViewport(viewport, from, to, width, height, pad);
    for (const [x, y] of [[0, 0], [1.2e17, 1e16], [-1e17, 2e17]]) {
      const before = screenPoint(from, viewport, x, y);
      const after = screenPoint(to, rebased, x, y);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });
});
