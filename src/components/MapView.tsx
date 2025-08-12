
import { useMemo, useState } from 'react';
import { exploreFrontier } from '../lib/graph';

const LY = 9.4607e15;

function project2D(x: number, _y: number, z: number) {
  // Simple orthographic projection: XZ-plane (x,z). Y is depth; ignored.
  return { px: x, py: -z };
}

export function MapView({ startId, maxJumps, graph, namesById, lyRadius, settings }: {
  startId: number;
  maxJumps: number;
  graph: any;
  namesById?: Record<string, string>;
  lyRadius: number;
  settings: { excludeZarzakh?: boolean; sameRegionOnly?: boolean };
}) {
  const startSystem = graph.systems[String(startId)];
  if (!startSystem) {
    return (
      <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-medium mb-3">Map</h2>
        <p className="text-sm text-red-600">Start system not found. Please enter a valid system name.</p>
      </section>
    );
  }

  const { nodes, edges } = useMemo(() => exploreFrontier({ startId, maxJumps, graph, settings }), [startId, maxJumps, graph, settings]);

  const projected = useMemo(() => {
    return nodes.map(n => {
      const s = graph.systems[String(n.id)];
      const { px, py } = project2D(s.position.x, s.position.y, s.position.z);
      return { id: n.id, dist: n.dist, hasObs: s.hasObservatory, px, py, x: s.position.x, y: s.position.y, z: s.position.z };
    });
  }, [nodes, graph]);

  const startProj = useMemo(() => {
    const s = graph.systems[String(startId)];
    const { px, py } = project2D(s.position.x, s.position.y, s.position.z);
    return { px, py };
  }, [graph, startId]);

  const startPos = useMemo(() => {
    const s = graph.systems[String(startId)];
    return { x: s.position.x, y: s.position.y, z: s.position.z };
  }, [graph, startId]);

  // SVG viewport and centering math
  const w = 800;
  const h = 600;
  const pad = 12;
  const cx = w / 2;
  const cy = h / 2;

  // Scale so the farthest node fits within the radius (minus padding)
  const baseScale = useMemo(() => {
    if (projected.length === 0) return 1;
    let maxD = 0;
    for (const p of projected) {
      const dx = p.px - startProj.px;
      const dy = p.py - startProj.py;
      const d = Math.hypot(dx, dy);
      if (d > maxD) maxD = d;
    }
    const radius = Math.max(1, Math.min(w, h) / 2 - pad);
    return maxD > 0 ? radius / maxD : 1;
  }, [projected, startProj]);

  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const scale = baseScale * zoom;

  const sx = (x: number) => cx + (x - startProj.px) * scale;
  const sy = (y: number) => cy + (y - startProj.py) * scale;

  // Quick lookup for edge endpoints
  const idx = useMemo(() => {
    const m: Record<string, { px: number; py: number }> = {};
    for (const p of projected) m[String(p.id)] = { px: p.px, py: p.py };
    return m;
  }, [projected]);

  // Cohen–Sutherland line clipping test: does segment (x1,y1)-(x2,y2) intersect rect [xMin,xMax]x[yMin,yMax]?
  function segmentIntersectsRect(x1: number, y1: number, x2: number, y2: number, xMin: number, yMin: number, xMax: number, yMax: number): boolean {
    const LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;
    const code = (x: number, y: number) => ((x < xMin ? LEFT : 0) | (x > xMax ? RIGHT : 0) | (y < yMin ? BOTTOM : 0) | (y > yMax ? TOP : 0));
    let c1 = code(x1, y1);
    let c2 = code(x2, y2);
    while (true) {
      if ((c1 | c2) === 0) return true; // both inside
      if ((c1 & c2) !== 0) return false; // trivially outside on same side
      const co = c1 ? c1 : c2;
      let x = 0, y = 0;
      if (co & TOP) { x = x1 + (x2 - x1) * (yMax - y1) / (y2 - y1); y = yMax; }
      else if (co & BOTTOM) { x = x1 + (x2 - x1) * (yMin - y1) / (y2 - y1); y = yMin; }
      else if (co & RIGHT) { y = y1 + (y2 - y1) * (xMax - x1) / (x2 - x1); x = xMax; }
      else { y = y1 + (y2 - y1) * (xMin - x1) / (x2 - x1); x = xMin; }
      if (co === c1) { x1 = x; y1 = y; c1 = code(x1, y1); } else { x2 = x; y2 = y; c2 = code(x2, y2); }
    }
  }

  // Determine which nodes are on-screen to avoid rendering off-screen nodes
  const visibleIds = useMemo(() => {
    const ids = new Set<number>();
    // small margin so dots near edges still render
    const pad = 8;
    for (const p of projected) {
      const X = sx(p.px);
      const Y = sy(p.py);
      if (X >= -pad && X <= w + pad && Y >= -pad && Y <= h + pad) ids.add(p.id);
    }
    return ids;
  }, [projected, startProj, scale]);

  const renderedNodes = useMemo(() => projected.filter(p => visibleIds.has(p.id)), [projected, visibleIds]);
  const renderedEdges = useMemo(() => {
    return edges.filter(([u, v]) => {
      if (visibleIds.has(u) || visibleIds.has(v)) return true;
      const a = idx[String(u)];
      const b = idx[String(v)];
      if (!a || !b) return false;
      const x1 = sx(a.px), y1 = sy(a.py);
      const x2 = sx(b.px), y2 = sy(b.py);
      return segmentIntersectsRect(x1, y1, x2, y2, 0, 0, w, h);
    });
  }, [edges, visibleIds, idx, scale, startProj]);

  const selected = useMemo(() => {
    if (selectedId == null) return null;
    const p = projected.find(n => n.id === selectedId);
    if (!p) return null;
    const sys = graph.systems[String(selectedId)];
    const jumps = p.dist;
    const ly = Math.hypot(p.x - startPos.x, p.y - startPos.y, p.z - startPos.z) / LY;
    const name = namesById?.[String(selectedId)] ?? String(selectedId);
    const regionName = graph.regionsById?.[String(sys.regionId)] ?? String(sys.regionId);
    const line = `${name} • ${regionName} • ${jumps}j • ${ly.toFixed(2)}ly`;
    // Measure text width precisely to size the popover tightly
    let measured = line.length * 7; // fallback heuristic
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Match the popup font (12px system sans)
        ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        measured = ctx.measureText(line).width;
      }
    }
    // Add padding (px-2 => 8px each side) + borders; clamp to sane bounds
    const approxWidth = Math.max(40, Math.min(800, Math.ceil(measured + 16 + 2)));
    const approxHeight = 32;
    return { p, sys, jumps, ly, name, regionName, line, approxWidth, approxHeight };
  }, [selectedId, projected, graph, startPos, namesById]);

  return (
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-medium mb-3">Map (range: {maxJumps} jump(s))</h2>
      <div className="flex items-center justify-end mb-2">
        <label className="text-sm mr-2">Zoom: {Math.round(zoom * 100)}%</label>
        <input
          type="range"
          min={50}
          max={1000}
          step={10}
          value={Math.round(zoom * 100)}
          onChange={(e) => setZoom(Number(e.target.value) / 100)}
          className="w-40 accent-blue-600"
        />
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[480px]" onClick={() => setSelectedId(null)}>
        {/* LY radius circle */}
        <g>
          {(() => {
            const r = (lyRadius * LY) * scale;
            return <circle cx={cx} cy={cy} r={r} fill="none" stroke="#60a5fa" strokeDasharray="6 6" strokeWidth={1.5} />;
          })()}
        </g>

        {/* edges (render only when at least one endpoint is visible) */}
        <g stroke="#aaa" strokeWidth={1} opacity={0.6}>
          {renderedEdges.map(([u, v], i) => {
            const a = idx[String(u)];
            const b = idx[String(v)];
            if (!a || !b) return null;
            // Use long dashes for inter-region connections
            const ur = graph.systems[String(u)]?.regionId;
            const vr = graph.systems[String(v)]?.regionId;
            const interRegion = ur != null && vr != null && ur !== vr;
            return (
              <line
                key={i}
                x1={sx(a.px)}
                y1={sy(a.py)}
                x2={sx(b.px)}
                y2={sy(b.py)}
                strokeDasharray={interRegion ? '12 8' : undefined}
              />
            );
          })}
        </g>
        {/* nodes */}
        <g>
          {renderedNodes.map(p => {
            const r = p.id === startId ? 5 : 3;
            const inLy = Math.hypot(p.x - startPos.x, p.y - startPos.y, p.z - startPos.z) <= lyRadius * LY;
            let fill: string;
if (p.id === startId) {
  fill = '#2563eb';
} else if (p.hasObs) {
  fill = inLy ? '#16a34a' : '#ef4444';
} else {
  fill = inLy ? '#64748b' : '#cbd5e1';
}
            const opacity = inLy || p.id === startId ? 1 : 0.6;
            const label = namesById?.[String(p.id)] ?? String(p.id);
            return (
              <g
                key={p.id}
                onClick={(e) => { e.stopPropagation(); setSelectedId(prev => (prev === p.id ? null : p.id)); }}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(h => (h === p.id ? null : h))}
                style={{cursor: "pointer"}}
              >
                <circle cx={sx(p.px)} cy={sy(p.py)} r={r} fill={fill} opacity={opacity} className="transition-transform duration-150 ease-out origin-center transform-gpu hover:scale-150" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
                {p.id === startId && (
                  <text x={sx(p.px)+8} y={sy(p.py)-8} className="text-xs fill-current">
                    {label}
                  </text>
                )}
                {p.id !== startId && hoveredId === p.id && selectedId !== p.id && (
                  <text x={sx(p.px)+8} y={sy(p.py)-8} className="text-xs fill-current pointer-events-none">
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {selected && (
          <foreignObject onClick={(e) => e.stopPropagation()} x={sx(selected.p.px)+10} y={Math.round(sy(selected.p.py) - 12)} width={selected.approxWidth} height={selected.approxHeight}>
            <div className="rounded-md border border-solid border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 shadow text-xs whitespace-nowrap" style={{ fontSize: 12, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>{selected.line}</div>
          </foreignObject>
        )}

      </svg>
      <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">
        <span className="inline-flex items-center mr-4"><span className="w-2 h-2 rounded-full inline-block mr-1" style={{background:'#2563eb'}}></span>Start</span>
        <span className="inline-flex items-center mr-4"><span className="w-2 h-2 rounded-full inline-block mr-1" style={{background:'#16a34a'}}></span>Observatory</span>
        <span className="inline-flex items-center"><span className="w-2 h-2 rounded-full inline-block mr-1" style={{background:'#64748b'}}></span>System</span>
        <span className="inline-flex items-center ml-4"><span className="inline-block border-t border-gray-500" style={{ width: 16, borderTopStyle: 'dashed' }}></span><span className="ml-1">Inter-region edge</span></span>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Distances are computed in 3D; the circle is a 2D projection guide.</div>
    </section>
  );
}
