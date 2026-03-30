import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { GraphData, SystemNode } from '../lib/data';
import { exploreFrontier, findPathTo } from '../lib/graph';
import { Icon } from './Icon';
import { boundsFromIds, buildAnsiblexSet, buildArcPath, centerFromBounds, fitBoundsScale, fitRadiusScale, LY_IN_METERS, project2D, segmentIntersectsRect } from './map/shared';

type MapViewSettings = {
  excludeZarzakh?: boolean;
  sameRegionOnly?: boolean;
  titanBridgeFirstJump?: boolean;
  allowAnsiblex?: boolean;
  ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }>;
};

type MapViewProps = {
  startId: number;
  maxJumps: number;
  graph: GraphData;
  namesById?: Record<string, string>;
  lyRadius: number;
  settings: MapViewSettings;
  onSystemDoubleClick?: (id: number) => void;
};

type MapViewBodyProps = MapViewProps & {
  startSystem: SystemNode;
};

export function MapView(props: MapViewProps) {
  const startSystem = props.graph.systems[String(props.startId)];
  if (!startSystem) {
    return (
      <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-medium mb-3">Map</h2>
        <p className="text-sm text-red-600">Start system not found. Please enter a valid system name.</p>
      </section>
    );
  }

  return <MapViewBody {...props} startSystem={startSystem} />;
}

function MapViewBody({ startId, maxJumps, graph, namesById, lyRadius, settings, onSystemDoubleClick, startSystem }: MapViewBodyProps) {
  const { nodes, edges } = useMemo(() => exploreFrontier({ startId, maxJumps, graph, settings, lyRadius }), [startId, maxJumps, graph, settings, lyRadius]);

  const projected = useMemo(() => {
    return nodes.map(n => {
      const s = graph.systems[String(n.id)];
      const { px, py } = project2D(s.position.x, s.position.y, s.position.z);
      return { id: n.id, dist: n.dist, hasObs: s.hasObservatory, px, py, x: s.position.x, y: s.position.y, z: s.position.z };
    });
  }, [nodes, graph]);

  const startProj = useMemo(() => {
    const { px, py } = project2D(startSystem.position.x, startSystem.position.y, startSystem.position.z);
    return { px, py };
  }, [startSystem]);

  const startPos = useMemo(() => {
    return { x: startSystem.position.x, y: startSystem.position.y, z: startSystem.position.z };
  }, [startSystem]);

  // SVG viewport and centering math
  const w = 800;
  const h = 600;
  const pad = 0;

  const projectedIds = useMemo(() => projected.map((point) => point.id), [projected]);
  const bounds = useMemo(() => boundsFromIds(graph, projectedIds), [graph, projectedIds]);
  const center = useMemo(() => centerFromBounds(bounds), [bounds]);
  const baseScale = useMemo(() => {
    if (!bounds) return 1;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    if (spanX === 0 && spanY === 0) {
      const minWorldRadius = lyRadius * LY_IN_METERS;
      return fitRadiusScale(projected, startProj, w, h, pad, minWorldRadius);
    }
    return fitBoundsScale(bounds, w, h, pad);
  }, [bounds, projected, startProj, lyRadius]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const resetAnimationFrameRef = useRef<number | null>(null);
  const viewportRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const scale = baseScale * zoom;

  const sx = useCallback((x: number) => (w / 2) + (x - center.cx) * scale + pan.x, [center.cx, pan.x, scale, w]);
  const sy = useCallback((y: number) => (h / 2) + (y - center.cy) * scale + pan.y, [center.cy, h, pan.y, scale]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  const cancelViewportAnimation = useCallback(() => {
    if (resetAnimationFrameRef.current == null) return;
    window.cancelAnimationFrame(resetAnimationFrameRef.current);
    resetAnimationFrameRef.current = null;
  }, []);

  const resetViewport = useCallback(() => {
    const startZoom = viewportRef.current.zoom;
    const startPan = viewportRef.current.pan;
    if (startZoom === 1 && startPan.x === 0 && startPan.y === 0) return;
    cancelViewportAnimation();
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = 240;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      setZoom(startZoom + (1 - startZoom) * eased);
      setPan({
        x: startPan.x * (1 - eased),
        y: startPan.y * (1 - eased),
      });
      if (t < 1) {
        resetAnimationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        resetAnimationFrameRef.current = null;
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };

    resetAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelViewportAnimation]);

  const handleZoomChange = useCallback((nextZoom: number) => {
    cancelViewportAnimation();
    const currentZoom = viewportRef.current.zoom;
    const currentPan = viewportRef.current.pan;
    if (currentZoom <= 0) {
      setZoom(nextZoom);
      return;
    }
    const ratio = nextZoom / currentZoom;
    setZoom(nextZoom);
    setPan({
      x: currentPan.x * ratio,
      y: currentPan.y * ratio,
    });
  }, [cancelViewportAnimation]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    cancelViewportAnimation();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
    };
    suppressClickRef.current = false;
  }, [cancelViewportAnimation, pan.x, pan.y]);

  useEffect(() => {
    viewportRef.current = { zoom, pan };
  }, [zoom, pan]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        drag.moved = true;
        suppressClickRef.current = true;
        setIsPanning(true);
        setHoveredId(null);
      }
      if (!drag.moved) return;
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
    };

    const finishPan = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragStateRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishPan);
    window.addEventListener('pointercancel', finishPan);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPan);
      window.removeEventListener('pointercancel', finishPan);
    };
  }, []);

  useEffect(() => () => cancelViewportAnimation(), [cancelViewportAnimation]);

  // Quick lookup for edge endpoints
  const idx = useMemo(() => {
    const m: Record<string, { px: number; py: number }> = {};
    for (const p of projected) m[String(p.id)] = { px: p.px, py: p.py };
    return m;
  }, [projected]);

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
  }, [projected, sx, sy, w, h]);

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
  }, [edges, visibleIds, idx, sx, sy, w, h]);

  const renderedAnsiblexes = useMemo(() => {
    if (!settings.allowAnsiblex || !Array.isArray(settings.ansiblexes)) return [];
    return settings.ansiblexes.filter((bridge) => {
      if (!bridge || bridge.enabled === false) return false;
      return visibleIds.has(Number(bridge.from)) || visibleIds.has(Number(bridge.to));
    });
  }, [settings.allowAnsiblex, settings.ansiblexes, visibleIds]);

  const selected = useMemo(() => {
    if (selectedId == null) return null;
    const p = projected.find(n => n.id === selectedId);
    if (!p) return null;
    const sys = graph.systems[String(selectedId)];
    const jumps = p.dist;
    const ly = Math.hypot(p.x - startPos.x, p.y - startPos.y, p.z - startPos.z) / LY_IN_METERS;
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
  const ansiSet = useMemo(
    () => buildAnsiblexSet(settings.allowAnsiblex, settings.ansiblexes, { defaultBidirectional: true }),
    [settings.allowAnsiblex, settings.ansiblexes],
  );

  return (
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-medium mb-3">Map (range: {maxJumps} jump(s))</h2>
      <div className="relative">
      <div className="absolute top-3 right-3 z-10 flex flex-col items-center gap-2">
        <div className="flex h-32 w-10 items-center justify-center">
          <input
            type="range"
            min={50}
            max={1000}
            step={10}
            value={Math.round(zoom * 100)}
            onChange={(e) => handleZoomChange(Number(e.target.value) / 100)}
            aria-label="Zoom"
            title="Zoom"
            className="w-28 -rotate-90 accent-blue-600"
          />
        </div>
        <button
          type="button"
          className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50"
          onClick={resetViewport}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          aria-label="Reset view"
          title="Reset view"
        >
          <Icon name="scope" size={18} />
        </button>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`w-full h-[480px] ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onClick={() => {
          if (consumeSuppressedClick()) return;
          setSelectedId(null);
        }}
        onPointerDown={handlePointerDown}
        style={{ touchAction: 'none' }}
      >
        {/* LY radius circle */}
        <g>
          {(() => {
            const r = (lyRadius * LY_IN_METERS) * scale;
            return <circle cx={sx(startProj.px)} cy={sy(startProj.py)} r={r} fill="none" stroke="#60a5fa" strokeDasharray="6 6" strokeWidth={1.5} />;
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

        {/* Ansiblex bridges (green arcs). Render when enabled in settings. */}
        {renderedAnsiblexes.map((b, idxArc) => {
          const fromSys = graph.systems[String(b.from)];
          const toSys = graph.systems[String(b.to)];
          if (!fromSys || !toSys) return null;
          const p1 = project2D(fromSys.position.x, fromSys.position.y, fromSys.position.z);
          const p2 = project2D(toSys.position.x, toSys.position.y, toSys.position.z);
          const A = { x: sx(p1.px), y: sy(p1.py) };
          const B = { x: sx(p2.px), y: sy(p2.py) };
          const d = buildArcPath(A, B, 0.22, 30, 120);
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

          const segs: Array<JSX.Element> = [];
          // First segment: if usedTitan (and titan is allowed), draw purple dashed arc; otherwise handle as gate/ansiblex
          for (let i = 0; i < path.length - 1; i++) {
            const u = path[i];
            const v = path[i + 1];
            const P = getPt(u);
            const Q = getPt(v);
            if (i === 0 && res.usedTitan && settings.titanBridgeFirstJump) {
              const d = buildArcPath(P, Q, 0.15, 20, 80);
              segs.push(<path key={`hl-titan-${i}`} d={d} stroke="#9333ea" strokeWidth={2} fill="none" strokeDasharray="4 3" opacity={0.95} />);
              continue;
            }
            const isAnsi = ansiSet.has(`${u}->${v}`);
            if (isAnsi) {
              const d = buildArcPath(P, Q, 0.22, 30, 120);
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
            const inLy = Math.hypot(p.x - startPos.x, p.y - startPos.y, p.z - startPos.z) <= lyRadius * LY_IN_METERS;
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (consumeSuppressedClick()) return;
                  setSelectedId(prev => (prev === p.id ? null : p.id));
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (consumeSuppressedClick()) return;
                  onSystemDoubleClick?.(p.id);
                }}
                onMouseEnter={() => { if (!isPanning) setHoveredId(p.id); }}
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
          <foreignObject
            data-map-no-pan="true"
            onClick={(e) => e.stopPropagation()}
            x={sx(selected.p.px)+10}
            y={Math.round(sy(selected.p.py) - 12)}
            width={selected.approxWidth}
            height={selected.approxHeight}
          >
            <div className="rounded-md border border-solid border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 shadow text-xs whitespace-nowrap" style={{ fontSize: 12, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
              <span>{selected.name} </span>
              <span style={{ color: selected.secColor, fontWeight: 700 }}>{selected.secLabel}</span>
              <span>{` • ${selected.regionName} • ${selected.jumps}j • ${selected.ly.toFixed(2)}ly`}</span>
            </div>
          </foreignObject>
        )}

      </svg>
      </div>
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
