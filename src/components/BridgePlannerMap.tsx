import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData } from '../lib/data';

function project2D(x: number, _y: number, z: number) {
  return { px: x, py: -z };
}

type BridgePlannerMapProps = {
  graph: GraphData | null;
  namesById?: Record<string, string>;
  stagingId: number | null;
  destinationId: number | null;
  parkingId: number | null;
  bridgeEndpointId: number | null;
  travelPath: number[] | null;
  postBridgePath: number[] | null;
  fitNodeIds?: number[] | null;
  bridgeRange: number;
  settings: { allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; enabled?: boolean; bidirectional?: boolean }> };
  statusMessage?: string | null;
  summary?: string | null;
  baselineJumps?: number | null;
};

type BackgroundNode = { id: number; x: number; y: number };
type BackgroundEdge = { x1: number; y1: number; x2: number; y2: number; interRegion: boolean };

export function BridgePlannerMap({
  graph,
  namesById,
  stagingId,
  destinationId,
  parkingId,
  bridgeEndpointId,
  travelPath,
  postBridgePath,
  fitNodeIds,
  bridgeRange,
  settings,
  statusMessage,
  summary,
  baselineJumps,
}: BridgePlannerMapProps) {
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasBase = !!graph && stagingId != null && destinationId != null;
  const hasRoute = hasBase && !!travelPath && travelPath.length > 0 && parkingId != null && bridgeEndpointId != null;

  const w = 800;
  const h = 600;
  const pad = 70;

  const nodeIds = useMemo(() => {
    if (!hasRoute || !travelPath) return [] as number[];
    const ids = new Set<number>();
    for (const id of travelPath) ids.add(id);
    if (stagingId != null) ids.add(stagingId);
    if (destinationId != null) ids.add(destinationId);
    if (parkingId != null) ids.add(parkingId);
    if (bridgeEndpointId != null) ids.add(bridgeEndpointId);
    if (postBridgePath) {
      for (const id of postBridgePath) ids.add(id);
    }
    return Array.from(ids.values());
  }, [hasRoute, travelPath, stagingId, destinationId, parkingId, bridgeEndpointId, postBridgePath]);

  const projected = useMemo(() => {
    if (!hasRoute || !graph) return [] as Array<{ id: number; px: number; py: number }>;
    const out: Array<{ id: number; px: number; py: number }> = [];
    for (const id of nodeIds) {
      const sys = graph.systems[String(id)];
      if (!sys) continue;
      const { px, py } = project2D(sys.position.x, sys.position.y, sys.position.z);
      out.push({ id, px, py });
    }
    return out;
  }, [nodeIds, graph, hasRoute]);

  const fitBounds = useMemo(() => {
    if (!graph || !fitNodeIds || fitNodeIds.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of fitNodeIds) {
      const sys = graph.systems[String(id)];
      if (!sys) continue;
      const { px, py } = project2D(sys.position.x, sys.position.y, sys.position.z);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { minX, maxX, minY, maxY };
  }, [graph, fitNodeIds]);

  const selectedBounds = useMemo(() => {
    if (!graph || (fitNodeIds && fitNodeIds.length > 0)) return null;
    if (nodeIds.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of nodeIds) {
      const sys = graph.systems[String(id)];
      if (!sys) continue;
      const { px, py } = project2D(sys.position.x, sys.position.y, sys.position.z);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { minX, maxX, minY, maxY };
  }, [graph, nodeIds, fitNodeIds]);

  const bounds = fitBounds ?? selectedBounds;

  const baseScale = useMemo(() => {
    if (!bounds) return 1;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    if (spanX === 0 && spanY === 0) return 1;
    if (spanX === 0) return (h - pad * 2) / spanY;
    if (spanY === 0) return (w - pad * 2) / spanX;
    return Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  }, [bounds]);

  const center = useMemo(() => {
    if (!bounds) return { cx: 0, cy: 0 };
    return { cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2 };
  }, [bounds]);

  const scale = baseScale * zoom;
  const sx = (x: number) => (w / 2) + (x - center.cx) * scale;
  const sy = (y: number) => (h / 2) + (y - center.cy) * scale;

  const pointsById = useMemo(() => {
    const m = new Map<number, { px: number; py: number }>();
    for (const p of projected) m.set(p.id, { px: p.px, py: p.py });
    return m;
  }, [projected]);

  const projectedAll = useMemo(() => {
    if (!graph || !hasRoute) return new Map<number, { px: number; py: number }>();
    const m = new Map<number, { px: number; py: number }>();
    for (const [idStr, sys] of Object.entries(graph.systems)) {
      const id = Number(idStr);
      if (!Number.isFinite(id)) continue;
      const { px, py } = project2D(sys.position.x, sys.position.y, sys.position.z);
      m.set(id, { px, py });
    }
    return m;
  }, [graph, hasRoute]);

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

  const ansiSet = useMemo(() => {
    const set = new Set<string>();
    if (settings.allowAnsiblex && Array.isArray(settings.ansiblexes)) {
      for (const b of settings.ansiblexes) {
        if (!b || b.enabled === false) continue;
        const from = Number(b.from);
        const to = Number(b.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        set.add(`${from}->${to}`);
        if (b.bidirectional !== false) set.add(`${to}->${from}`);
      }
    }
    return set;
  }, [settings.allowAnsiblex, settings.ansiblexes]);

  const routeSegments = useMemo(() => {
    if (!travelPath || travelPath.length < 2) return [] as Array<{ from: number; to: number; type: 'gate' | 'ansi' }>;
    const segs: Array<{ from: number; to: number; type: 'gate' | 'ansi' }> = [];
    for (let i = 0; i < travelPath.length - 1; i++) {
      const from = travelPath[i];
      const to = travelPath[i + 1];
      const type = ansiSet.has(`${from}->${to}`) ? 'ansi' : 'gate';
      segs.push({ from, to, type });
    }
    return segs;
  }, [travelPath, ansiSet]);

  const postBridgeSegments = useMemo(() => {
    if (!postBridgePath || postBridgePath.length < 2) return [] as Array<{ from: number; to: number; type: 'gate' | 'ansi' }>;
    const segs: Array<{ from: number; to: number; type: 'gate' | 'ansi' }> = [];
    for (let i = 0; i < postBridgePath.length - 1; i++) {
      const from = postBridgePath[i];
      const to = postBridgePath[i + 1];
      const type = ansiSet.has(`${from}->${to}`) ? 'ansi' : 'gate';
      segs.push({ from, to, type });
    }
    return segs;
  }, [postBridgePath, ansiSet]);

  const backgroundNodes = useMemo(() => {
    if (!graph || !hasRoute) return [] as BackgroundNode[];
    const list: BackgroundNode[] = [];
    const margin = 6;
    for (const [id, p] of projectedAll.entries()) {
      const x = sx(p.px);
      const y = sy(p.py);
      if (x < -margin || x > w + margin || y < -margin || y > h + margin) continue;
      list.push({ id, x, y });
    }
    return list;
  }, [graph, hasRoute, projectedAll, scale, center]);

  const backgroundEdges = useMemo(() => {
    if (!graph || !hasRoute) return [] as BackgroundEdge[];
    const edges: BackgroundEdge[] = [];
    const seen = new Set<string>();
    for (const [idStr, sys] of Object.entries(graph.systems)) {
      const id = Number(idStr);
      if (!Number.isFinite(id)) continue;
      const from = projectedAll.get(id);
      if (!from) continue;
      for (const next of sys.adjacentSystems) {
        const key = id < next ? `${id}-${next}` : `${next}-${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const to = projectedAll.get(next);
        if (!to) continue;
        const x1 = sx(from.px);
        const y1 = sy(from.py);
        const x2 = sx(to.px);
        const y2 = sy(to.py);
        if (!segmentIntersectsRect(x1, y1, x2, y2, 0, 0, w, h)) continue;
        const interRegion = sys.regionId != null && graph.systems[String(next)]?.regionId != null && sys.regionId !== graph.systems[String(next)]?.regionId;
        edges.push({ x1, y1, x2, y2, interRegion });
      }
    }
    return edges;
  }, [graph, hasRoute, projectedAll, scale, center]);

  const arcPath = (A: { x: number; y: number }, B: { x: number; y: number }, ampScale = 0.22, minAmp = 28, maxAmp = 140) => {
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

  const getPt = (id: number) => {
    const p = pointsById.get(id);
    if (!p) return null;
    return { x: sx(p.px), y: sy(p.py) };
  };

  const labelIds = useMemo(() => {
    if (!hasRoute) return [] as number[];
    const ids = new Set<number>([stagingId, parkingId, destinationId, bridgeEndpointId].filter((v): v is number => v != null));
    return Array.from(ids.values());
  }, [hasRoute, stagingId, parkingId, destinationId, bridgeEndpointId]);

  const nameFor = (id: number) => namesById?.[String(id)] ?? String(id);
  const getScreenPt = (id: number) => {
    const p = projectedAll.get(id);
    if (!p) return null;
    return { x: sx(p.px), y: sy(p.py) };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (const edge of backgroundEdges) {
      ctx.strokeStyle = edge.interRegion ? '#94a3b8' : '#cbd5f5';
      ctx.globalAlpha = edge.interRegion ? 0.35 : 0.45;
      if (edge.interRegion) ctx.setLineDash([6, 6]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(edge.x1, edge.y1);
      ctx.lineTo(edge.x2, edge.y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#cbd5e1';
    for (const node of backgroundNodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [backgroundEdges, backgroundNodes]);

  if (!hasBase) {
    return (
      <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-medium mb-2">Map</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">Select a destination and staging system to preview the route.</p>
      </section>
    );
  }

  if (!hasRoute) {
    return (
      <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-medium mb-2">Map</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{statusMessage || 'No route to display yet.'}</p>
        {baselineJumps != null && (
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            Direct route: {baselineJumps}j without bridge
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <h2 className="text-xl font-medium">Map</h2>
          <div className="text-sm text-slate-600 dark:text-slate-300">Bridge range: {bridgeRange.toFixed(1)} ly</div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Direct route: {baselineJumps == null ? 'unreachable' : `${baselineJumps}j`} without bridge
          </div>
          {summary && <div className="text-sm text-slate-600 dark:text-slate-300">{summary}</div>}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">Zoom: {Math.round(zoom * 100)}%</label>
          <input
            type="range"
            min={60}
            max={220}
            step={5}
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
            className="w-32 accent-amber-600"
          />
        </div>
      </div>

      <div className="relative w-full h-[480px]">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <svg viewBox={`0 0 ${w} ${h}`} className="relative w-full h-full">
        <defs>
          <marker id="titanArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9333ea" />
          </marker>
          <clipPath id="mapClip">
            <rect x="0" y="0" width={w} height={h} />
          </clipPath>
        </defs>

        <g clipPath="url(#mapClip)">
          {/* Travel path segments (pre-bridge) */}
          <g strokeLinecap="round">
            {routeSegments.map((seg, idx) => {
              const A = getPt(seg.from);
              const B = getPt(seg.to);
              if (!A || !B) return null;
              if (seg.type === 'ansi') {
                const d = arcPath(A, B, 0.25, 26, 140);
                return <path key={`seg-ansi-${idx}`} d={d} stroke="#22c55e" strokeWidth={2.5} fill="none" opacity={0.9} />;
              }
              return <line key={`seg-gate-${idx}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#facc15" strokeWidth={2.5} opacity={0.95} />;
            })}
          </g>

          {/* Post-bridge path segments */}
          <g strokeLinecap="round">
            {postBridgeSegments.map((seg, idx) => {
              const A = getPt(seg.from);
              const B = getPt(seg.to);
              if (!A || !B) return null;
              if (seg.type === 'ansi') {
                const d = arcPath(A, B, 0.22, 22, 130);
                return <path key={`seg-post-ansi-${idx}`} d={d} stroke="#22c55e" strokeWidth={2} fill="none" opacity={0.6} strokeDasharray="4 4" />;
              }
              return <line key={`seg-post-gate-${idx}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#facc15" strokeWidth={2} opacity={0.6} strokeDasharray="4 4" />;
            })}
          </g>

          {/* Titan bridge segment */}
          {parkingId != null && bridgeEndpointId != null && parkingId !== bridgeEndpointId && (() => {
            const A = getPt(parkingId);
            const B = getPt(bridgeEndpointId);
            if (!A || !B) return null;
            const d = arcPath(A, B, 0.18, 30, 160);
            return (
              <path
                d={d}
                stroke="#9333ea"
                strokeWidth={3}
                fill="none"
                strokeDasharray="6 5"
                opacity={0.95}
                markerEnd="url(#titanArrow)"
              />
            );
          })()}

          {/* Highlighted nodes */}
          <g>
            {[
              { id: stagingId, color: '#2563eb', label: 'Staging' },
              { id: destinationId, color: '#ef4444', label: 'Destination' },
              { id: parkingId, color: '#f59e0b', label: 'Parking' },
              { id: bridgeEndpointId, color: '#a855f7', label: 'Bridge endpoint' },
            ].map((item) => {
              if (item.id == null) return null;
              const pt = getScreenPt(item.id);
              if (!pt) return null;
              return (
                <circle key={`focus-${item.label}`} cx={pt.x} cy={pt.y} r={5} fill={item.color}>
                  <title>{item.label}</title>
                </circle>
              );
            })}
          </g>
        </g>

        {/* Labels */}
        <g className="text-xs fill-current text-slate-900 dark:text-slate-100">
          {labelIds.map((id) => {
            const pt = projectedAll.get(id) || pointsById.get(id);
            if (!pt) return null;
            return (
              <text key={`label-${id}`} x={sx(pt.px) + 8} y={sy(pt.py) - 8}>
                {nameFor(id)}
              </text>
            );
          })}
        </g>
      </svg>
      </div>

      <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 flex flex-wrap gap-4">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#2563eb' }}></span>Staging</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#f59e0b' }}></span>Parking</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }}></span>Destination</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#a855f7' }}></span>Bridge endpoint</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: '#facc15' }}></span>Gates</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: '#22c55e' }}></span>Ansiblex</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px border-t-2 border-dashed" style={{ borderColor: '#facc15' }}></span>Post-bridge route</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px border-t-2 border-dashed" style={{ borderColor: '#9333ea' }}></span>Titan bridge</span>
      </div>
    </section>
  );
}
