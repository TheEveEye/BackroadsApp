
import { useMemo, useState } from 'react';
import { exploreFrontier, findPathTo } from '../lib/graph';

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
  settings: { excludeZarzakh?: boolean; sameRegionOnly?: boolean; titanBridgeFirstJump?: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }>; };
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

  const { nodes, edges } = useMemo(() => exploreFrontier({ startId, maxJumps, graph, settings, lyRadius }), [startId, maxJumps, graph, settings, lyRadius]);

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
    // Farthest node distance from start in world units (projected XZ plane)
    let maxDNodes = 0;
    for (const p of projected) {
      const dx = p.px - startProj.px;
      const dy = p.py - startProj.py;
      const d = Math.hypot(dx, dy);
      if (d > maxDNodes) maxDNodes = d;
    }
    // Target radius in screen pixels
    const radiusPx = Math.max(1, Math.min(w, h) / 2 - pad);
    // When maxJumps is 0 the frontier contains only the start node, so maxDNodes≈0.
    // In that case, also consider the LY radius circle so we don't render an enormous SVG circle.
    const lyWorld = lyRadius * LY;
    const maxWorld = maxJumps === 0 ? Math.max(maxDNodes, lyWorld) : maxDNodes;
    return maxWorld > 0 ? radiusPx / maxWorld : 1;
  }, [projected, startProj, maxJumps, lyRadius]);

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
  const secColors = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
  const sVal = typeof sys.security === 'number' ? sys.security : 0;
  const sIdx = sVal <= 0 ? 0 : Math.min(10, Math.ceil(sVal * 10));
  const secColor = secColors[sIdx] || secColors[0];
  const secLabel = sVal.toFixed(1);
    const regionName = graph.regionsById?.[String(sys.regionId)] ?? String(sys.regionId);
  const line = `${name} ${secLabel} • ${regionName} • ${jumps}j • ${ly.toFixed(2)}ly`;
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
  return { p, sys, jumps, ly, name, regionName, line, approxWidth, approxHeight, secColor, secLabel };
  }, [selectedId, projected, graph, startPos, namesById]);

  // Build a quick lookup for ansiblex directed edges (u->v) to detect segments in the route
  const ansiSet = useMemo(() => {
    const set = new Set<string>();
    if (settings.allowAnsiblex && Array.isArray(settings.ansiblexes)) {
      for (const b of settings.ansiblexes) {
        if (!b || b.enabled === false) continue;
        const from = Number(b.from), to = Number(b.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        set.add(`${from}->${to}`);
  // Always treat bridges as bidirectional
  set.add(`${to}->${from}`);
      }
    }
    return set;
  }, [settings.allowAnsiblex, settings.ansiblexes]);

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
  {/* (moved bridge rendering after edges) */}

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

        {/* Ansiblex bridges (green arcs). Render when enabled in settings. */}
        {settings.allowAnsiblex && Array.isArray(settings.ansiblexes) && settings.ansiblexes.filter(b=>b.enabled!==false).map((b, idxArc) => {
          const fromSys = graph.systems[String(b.from)];
          const toSys = graph.systems[String(b.to)];
          if (!fromSys || !toSys) return null;
          const p1 = project2D(fromSys.position.x, fromSys.position.y, fromSys.position.z);
          const p2 = project2D(toSys.position.x, toSys.position.y, toSys.position.z);
          const A = { x: sx(p1.px), y: sy(p1.py) };
          const B = { x: sx(p2.px), y: sy(p2.py) };
          const mx = (A.x + B.x) / 2;
          const my = (A.y + B.y) / 2;
          const dx = B.x - A.x, dy = B.y - A.y;
          const len = Math.hypot(dx, dy) || 1;
          let nx = -dy / len, ny = dx / len;
          if (Math.abs(ny) < 1e-6) { nx = 0; ny = -1; }
          else if (ny > 0) { nx = -nx; ny = -ny; }
          const amp = Math.min(120, Math.max(30, len * 0.22));
          const cxp = mx + nx * amp;
          const cyp = my + ny * amp;
          const d = `M ${A.x} ${A.y} Q ${cxp} ${cyp} ${B.x} ${B.y}`;
          return (
            <g key={`ansi-${idxArc}`}>
              <path d={d} stroke="#00ff00" strokeWidth={2} fill="none" opacity={0.95} />
            </g>
          );
        })}

        {/* Route highlight (selected or hover): draw titan arc if used, ansiblex arcs for ansiblex segments, and yellow lines for gate segments */}
        {(selectedId != null || hoveredId != null) && (() => {
          const targetId = selectedId ?? hoveredId!;
          const res = findPathTo({ startId, targetId, maxJumps, graph, settings, lyRadius });
          const path = res.path;
          if (!path || path.length < 2) return null;
          const getPt = (id: number) => {
            const sys = graph.systems[String(id)];
            const p2 = project2D(sys.position.x, sys.position.y, sys.position.z);
            return { x: sx(p2.px), y: sy(p2.py) };
          };

          const arcPath = (A: {x:number;y:number}, B: {x:number;y:number}, ampScale = 0.18, minAmp = 24, maxAmp = 120) => {
            const mx = (A.x + B.x) / 2;
            const my = (A.y + B.y) / 2;
            const dx = B.x - A.x, dy = B.y - A.y;
            const len = Math.hypot(dx, dy) || 1;
            let nx = -dy / len, ny = dx / len;
            if (Math.abs(ny) < 1e-6) { nx = 0; ny = -1; }
            else if (ny > 0) { nx = -nx; ny = -ny; }
            const amp = Math.min(maxAmp, Math.max(minAmp, len * ampScale));
            const cxp = mx + nx * amp;
            const cyp = my + ny * amp;
            return `M ${A.x} ${A.y} Q ${cxp} ${cyp} ${B.x} ${B.y}`;
          };

          const segs: any[] = [];
          // First segment: if usedTitan (and titan is allowed), draw purple dashed arc; otherwise handle as gate/ansiblex
          for (let i = 0; i < path.length - 1; i++) {
            const u = path[i];
            const v = path[i + 1];
            const P = getPt(u);
            const Q = getPt(v);
            if (i === 0 && res.usedTitan && settings.titanBridgeFirstJump) {
              const d = arcPath(P, Q, 0.15, 20, 80);
              segs.push(<path key={`hl-titan-${i}`} d={d} stroke="#9333ea" strokeWidth={2} fill="none" strokeDasharray="4 3" opacity={0.95} />);
              continue;
            }
            const isAnsi = ansiSet.has(`${u}->${v}`);
            if (isAnsi) {
              const d = arcPath(P, Q, 0.22, 30, 120);
              segs.push(<path key={`hl-ansi-${i}`} d={d} stroke="#facc15" strokeWidth={2.5} fill="none" opacity={0.95} />);
            } else {
              segs.push(<line key={`hl-line-${i}`} x1={P.x} y1={P.y} x2={Q.x} y2={Q.y} stroke="#facc15" strokeWidth={2.5} strokeLinecap="round" />);
            }
          }
          return <g>{segs}</g>;
        })()}
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
                {p.id !== startId && hoveredId === p.id && selectedId !== p.id && (() => {
                  const sys = graph.systems[String(p.id)];
                  const sVal = typeof sys.security === 'number' ? sys.security : 0;
                  const idx = sVal <= 0 ? 0 : Math.min(10, Math.ceil(sVal * 10));
                  const colors = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
                  const color = colors[idx] || colors[0];
                  return (
                    <text x={sx(p.px)+8} y={sy(p.py)-8} className="text-xs fill-current pointer-events-none">
                      {label} <tspan style={{ fill: color, fontWeight: 700 }}>{sVal.toFixed(1)}</tspan>
                    </text>
                  );
                })()}
              </g>
            );
          })}
        </g>

        {selected && (
          <foreignObject onClick={(e) => e.stopPropagation()} x={sx(selected.p.px)+10} y={Math.round(sy(selected.p.py) - 12)} width={selected.approxWidth} height={selected.approxHeight}>
            <div className="rounded-md border border-solid border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 shadow text-xs whitespace-nowrap" style={{ fontSize: 12, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
              <span>{selected.name} </span>
              <span style={{ color: selected.secColor, fontWeight: 700 }}>{selected.secLabel}</span>
              <span>{` • ${selected.regionName} • ${selected.jumps}j • ${selected.ly.toFixed(2)}ly`}</span>
            </div>
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
