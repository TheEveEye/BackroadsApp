import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GraphData } from '../lib/data';
import { findPathTo } from '../lib/graph';
import { Icon } from './Icon';
import { LY_IN_METERS, boundsFromIds, buildAnsiblexSet, buildArcPath, buildProjectedSystemMap, centerFromBounds, fitBoundsScale, project2D, segmentIntersectsRect } from './map/shared';

function getIsDarkMode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const bg = window.getComputedStyle(document.body).backgroundColor || '';
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
    if (match) {
      const r = Number(match[1]) / 255;
      const g = Number(match[2]) / 255;
      const b = Number(match[3]) / 255;
      const a = match[4] != null ? Number(match[4]) : 1;
      if (a > 0) {
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance < 0.45;
      }
    }
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

type BridgePlannerMapProps = {
  graph: GraphData | null;
  namesById?: Record<string, string>;
  stagingId: number | null;
  destinationId: number | null;
  bridgeLegs: Array<{
    parkingId: number;
    endpointId: number;
    approachPath: number[];
    approachJumps: number;
    bridgeLy: number;
  }> | null;
  postBridgePaths: number[][] | null;
  fitNodeIds?: number[] | null;
  bridgeRange: number;
  settings: {
    excludeZarzakh?: boolean;
    sameRegionOnly?: boolean;
    allowAnsiblex?: boolean;
    ansiblexes?: Array<{ from: number; to: number; enabled?: boolean; bidirectional?: boolean }>;
    cynoBeacons?: Array<{ id: number; enabled?: boolean }>;
  };
  statusMessage?: string | null;
  baselineJumps?: number | null;
  onSystemDoubleClick?: (id: number) => void;
};

type BackgroundNode = { id: number; x: number; y: number };
type BackgroundEdge = { x1: number; y1: number; x2: number; y2: number; interRegion: boolean };

export function BridgePlannerMap({
  graph,
  namesById,
  stagingId,
  destinationId,
  bridgeLegs,
  postBridgePaths,
  fitNodeIds,
  bridgeRange,
  settings,
  statusMessage,
  baselineJumps,
  onSystemDoubleClick,
}: BridgePlannerMapProps) {
  const base = (import.meta as any).env?.BASE_URL || '/';
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const hasBase = !!graph && stagingId != null && destinationId != null;
  const hasRoute = hasBase && Array.isArray(bridgeLegs) && bridgeLegs.length > 0;

  const w = 800;
  const h = 600;
  const pad = 70;
  const approachPaths = useMemo(
    () => (bridgeLegs ?? []).map((leg) => leg.approachPath).filter((path) => path.length > 1),
    [bridgeLegs],
  );

  const nodeIds = useMemo(() => {
    if (!hasRoute || !bridgeLegs) return [] as number[];
    const ids = new Set<number>();
    if (stagingId != null) ids.add(stagingId);
    if (destinationId != null) ids.add(destinationId);
    for (const leg of bridgeLegs) {
      for (const id of leg.approachPath) ids.add(id);
      ids.add(leg.parkingId);
      ids.add(leg.endpointId);
    }
    if (postBridgePaths) {
      for (const path of postBridgePaths) {
        for (const id of path) ids.add(id);
      }
    }
    return Array.from(ids.values());
  }, [bridgeLegs, destinationId, hasRoute, postBridgePaths, stagingId]);

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
    return boundsFromIds(graph, fitNodeIds);
  }, [graph, fitNodeIds]);

  const selectedBounds = useMemo(() => {
    if (!graph || (fitNodeIds && fitNodeIds.length > 0)) return null;
    return boundsFromIds(graph, nodeIds);
  }, [graph, nodeIds, fitNodeIds]);

  const bounds = fitBounds ?? selectedBounds;

  const baseScale = useMemo(() => {
    return fitBoundsScale(bounds, w, h, pad);
  }, [bounds]);

  const center = useMemo(() => {
    return centerFromBounds(bounds);
  }, [bounds]);

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

  const pointsById = useMemo(() => {
    const m = new Map<number, { px: number; py: number }>();
    for (const p of projected) m.set(p.id, { px: p.px, py: p.py });
    return m;
  }, [projected]);

  const projectedAll = useMemo(() => {
    if (!hasRoute) return new Map<number, { px: number; py: number }>();
    return buildProjectedSystemMap(graph);
  }, [graph, hasRoute]);

  const ansiSet = useMemo(
    () => buildAnsiblexSet(settings.allowAnsiblex, settings.ansiblexes, { defaultBidirectional: true }),
    [settings.allowAnsiblex, settings.ansiblexes],
  );

  const routeSegments = useMemo(() => {
    if (approachPaths.length === 0) return [] as Array<{ from: number; to: number; type: 'gate' | 'ansi' }>;
    const segs: Array<{ from: number; to: number; type: 'gate' | 'ansi' }> = [];
    for (const path of approachPaths) {
      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i];
        const to = path[i + 1];
        const type = ansiSet.has(`${from}->${to}`) ? 'ansi' : 'gate';
        segs.push({ from, to, type });
      }
    }
    return segs;
  }, [ansiSet, approachPaths]);

  const postBridgeSegments = useMemo(() => {
    if (!postBridgePaths || postBridgePaths.length === 0) return [] as Array<{ from: number; to: number; type: 'gate' | 'ansi' }>;
    const segs: Array<{ from: number; to: number; type: 'gate' | 'ansi' }> = [];
    for (const path of postBridgePaths) {
      if (path.length < 2) continue;
      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i];
        const to = path[i + 1];
        const type = ansiSet.has(`${from}->${to}`) ? 'ansi' : 'gate';
        segs.push({ from, to, type });
      }
    }
    return segs;
  }, [postBridgePaths, ansiSet]);

  const nameFor = (id: number) => namesById?.[String(id)] ?? String(id);
  const getScreenPt = useCallback((id: number) => {
    const p = projectedAll.get(id);
    if (!p) return null;
    return { x: sx(p.px), y: sy(p.py) };
  }, [projectedAll, sx, sy]);

  const cynoBeaconMarkers = useMemo(() => {
    if (!graph || !settings.cynoBeacons?.length) return [] as Array<{ id: number; x: number; y: number; enabled: boolean }>;
    const seen = new Set<number>();
    const markers: Array<{ id: number; x: number; y: number; enabled: boolean }> = [];
    for (const entry of settings.cynoBeacons) {
      if (!entry) continue;
      const id = Number(entry.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      const pt = getScreenPt(id);
      if (!pt) continue;
      markers.push({ id, x: pt.x, y: pt.y, enabled: entry.enabled !== false });
    }
    return markers;
  }, [getScreenPt, graph, settings.cynoBeacons]);

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
  }, [graph, hasRoute, projectedAll, sx, sy, w, h]);

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
  }, [graph, hasRoute, projectedAll, sx, sy, w, h]);

  const getPt = (id: number) => {
    const p = pointsById.get(id);
    if (!p) return null;
    return { x: sx(p.px), y: sy(p.py) };
  };

  const labelIds = useMemo(() => {
    if (!hasRoute) return [] as number[];
    const ids = new Set<number>();
    if (stagingId != null) ids.add(stagingId);
    if (destinationId != null) ids.add(destinationId);
    for (const leg of bridgeLegs ?? []) {
      ids.add(leg.parkingId);
      ids.add(leg.endpointId);
    }
    return Array.from(ids.values());
  }, [bridgeLegs, destinationId, hasRoute, stagingId]);

  const focusNodeColors = useMemo(() => {
    const colors = new Map<number, string>();
    for (const leg of bridgeLegs ?? []) {
      colors.set(leg.parkingId, '#f59e0b');
      colors.set(leg.endpointId, '#a855f7');
    }
    if (stagingId != null) colors.set(stagingId, '#2563eb');
    if (destinationId != null) colors.set(destinationId, '#ef4444');
    return colors;
  }, [bridgeLegs, destinationId, stagingId]);

  const startPos = useMemo(() => {
    if (!graph || stagingId == null) return null;
    const system = graph.systems[String(stagingId)];
    if (!system) return null;
    return system.position;
  }, [graph, stagingId]);

  const selected = useMemo(() => {
    if (!graph || stagingId == null || startPos == null || selectedId == null) return null;
    const system = graph.systems[String(selectedId)];
    const projected = projectedAll.get(selectedId) || pointsById.get(selectedId);
    if (!system || !projected) return null;
    const route = findPathTo({
      startId: stagingId,
      targetId: selectedId,
      maxJumps: 200,
      graph,
      settings: {
        excludeZarzakh: settings.excludeZarzakh,
        sameRegionOnly: settings.sameRegionOnly,
        allowAnsiblex: settings.allowAnsiblex,
        ansiblexes: settings.ansiblexes,
      },
      lyRadius: bridgeRange,
    });
    const jumps = route.path ? route.path.length - 1 : null;
    const ly = Math.hypot(
      system.position.x - startPos.x,
      system.position.y - startPos.y,
      system.position.z - startPos.z,
    ) / LY_IN_METERS;
    const name = namesById?.[String(selectedId)] ?? String(selectedId);
    const secColors = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
    const sVal = typeof system.security === 'number' ? system.security : 0;
    const sIdx = sVal <= 0 ? 0 : Math.min(10, Math.ceil(sVal * 10));
    const secColor = secColors[sIdx] || secColors[0];
    const secLabel = sVal.toFixed(1);
    const regionName = graph.regionsById?.[String(system.regionId)] ?? String(system.regionId);
    const line = `${name} ${secLabel} • ${regionName} • ${jumps == null ? 'unreachable' : `${jumps}j`} • ${ly.toFixed(2)}ly`;
    let measured = line.length * 7;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        measured = ctx.measureText(line).width;
      }
    }
    const approxWidth = Math.max(40, Math.min(800, Math.ceil(measured + 16 + 2)));
    const approxHeight = 32;
    return { projected, name, regionName, jumps, ly, secColor, secLabel, approxWidth, approxHeight };
  }, [
    bridgeRange,
    graph,
    namesById,
    pointsById,
    projectedAll,
    selectedId,
    settings.allowAnsiblex,
    settings.ansiblexes,
    settings.excludeZarzakh,
    settings.sameRegionOnly,
    stagingId,
    startPos,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDarkMode(getIsDarkMode());
    update();
    if (media.addEventListener) {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

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
    ctx.fillStyle = isDarkMode ? '#64748b' : '#cbd5e1';
    for (const node of backgroundNodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [backgroundEdges, backgroundNodes, isDarkMode]);

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
      <div className="mb-2">
        <h2 className="text-xl font-medium">Map</h2>
      </div>

      <div className="relative w-full h-[480px]">
        <div className="absolute top-3 right-3 z-10 flex flex-col items-center gap-2">
          <div className="flex h-32 w-10 items-center justify-center">
            <input
              type="range"
              min={60}
              max={220}
              step={5}
              value={Math.round(zoom * 100)}
              onChange={(e) => handleZoomChange(Number(e.target.value) / 100)}
              aria-label="Zoom"
              title="Zoom"
              className="w-28 -rotate-90 accent-amber-600"
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
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className={`relative w-full h-full ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          onClick={() => {
            if (consumeSuppressedClick()) return;
            setSelectedId(null);
          }}
          onPointerDown={handlePointerDown}
          style={{ touchAction: 'none' }}
        >
        <defs>
          <marker id="titanArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9333ea" />
          </marker>
          <clipPath id="mapClip">
            <rect x="0" y="0" width={w} height={h} />
          </clipPath>
        </defs>

        <g clipPath="url(#mapClip)">
          {/* Configured cyno beacons */}
          <g>
            {cynoBeaconMarkers.map((marker) => (
              <image
                key={`cyno-beacon-${marker.id}`}
                href={`${base}eve/cynosuralBeacon.png`}
                x={marker.x - 8}
                y={marker.y - 8}
                width={16}
                height={16}
                opacity={marker.enabled ? 0.95 : 0.35}
                style={{ filter: isDarkMode ? undefined : 'invert(1)' }}
                preserveAspectRatio="xMidYMid meet"
              >
                <title>{`${nameFor(marker.id)} cyno beacon${marker.enabled ? '' : ' (offline)'}`}</title>
              </image>
            ))}
          </g>

          {/* Travel path segments (pre-bridge) */}
          <g strokeLinecap="round">
            {routeSegments.map((seg, idx) => {
              const A = getPt(seg.from);
              const B = getPt(seg.to);
              if (!A || !B) return null;
              if (seg.type === 'ansi') {
                const d = buildArcPath(A, B, 0.25, 26, 140);
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
                const d = buildArcPath(A, B, 0.22, 22, 130);
                return <path key={`seg-post-ansi-${idx}`} d={d} stroke="#22c55e" strokeWidth={2} fill="none" opacity={0.6} strokeDasharray="4 4" />;
              }
              return <line key={`seg-post-gate-${idx}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#facc15" strokeWidth={2} opacity={0.6} strokeDasharray="4 4" />;
            })}
          </g>

          {/* Titan bridge segment */}
          {(bridgeLegs ?? []).map((leg, idx) => {
            if (leg.parkingId === leg.endpointId) return null;
            const A = getPt(leg.parkingId);
            const B = getPt(leg.endpointId);
            if (!A || !B) return null;
            const d = buildArcPath(A, B, 0.18, 30, 160);
            return (
              <path
                key={`bridge-leg-${idx}`}
                d={d}
                stroke="#9333ea"
                strokeWidth={3}
                fill="none"
                strokeDasharray="6 5"
                opacity={idx === 0 ? 0.95 : 0.8}
                markerEnd="url(#titanArrow)"
              />
            );
          })}

          {/* Highlighted nodes */}
          <g>
            {backgroundNodes.map((node) => {
              const label = nameFor(node.id);
              const fill = focusNodeColors.get(node.id);
              return (
                <g
                  key={`node-${node.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (consumeSuppressedClick()) return;
                    setSelectedId((prev) => (prev === node.id ? null : node.id));
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (consumeSuppressedClick()) return;
                    onSystemDoubleClick?.(node.id);
                  }}
                  onMouseEnter={() => { if (!isPanning) setHoveredId(node.id); }}
                  onMouseLeave={() => setHoveredId((prev) => (prev === node.id ? null : prev))}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={fill ? 5 : 6}
                    fill={fill ?? 'transparent'}
                    pointerEvents="all"
                  />
                  {node.id !== selectedId && hoveredId === node.id && (() => {
                    const sys = graph.systems[String(node.id)];
                    const sVal = typeof sys?.security === 'number' ? sys.security : 0;
                    const idx = sVal <= 0 ? 0 : Math.min(10, Math.ceil(sVal * 10));
                    const colors = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
                    const color = colors[idx] || colors[0];
                    return (
                      <text x={node.x + 8} y={node.y - 8} className="text-xs fill-current pointer-events-none">
                        {label} <tspan style={{ fill: color, fontWeight: 700 }}>{sVal.toFixed(1)}</tspan>
                      </text>
                    );
                  })()}
                </g>
              );
            })}
          </g>
        </g>

        {selected && (
          <foreignObject
            data-map-no-pan="true"
            onClick={(event) => event.stopPropagation()}
            x={sx(selected.projected.px) + 10}
            y={Math.round(sy(selected.projected.py) - 12)}
            width={selected.approxWidth}
            height={selected.approxHeight}
          >
            <div className="rounded-md border border-solid border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 shadow text-xs whitespace-nowrap" style={{ fontSize: 12, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
              <span>{selected.name} </span>
              <span style={{ color: selected.secColor, fontWeight: 700 }}>{selected.secLabel}</span>
              <span>{` • ${selected.regionName} • ${selected.jumps == null ? 'unreachable' : `${selected.jumps}j`} • ${selected.ly.toFixed(2)}ly`}</span>
            </div>
          </foreignObject>
        )}

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
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#f59e0b' }}></span>Parking systems</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }}></span>Destination</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#a855f7' }}></span>Bridge endpoints</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: '#facc15' }}></span>Gates</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: '#22c55e' }}></span>Ansiblex</span>
        <span className="inline-flex items-center gap-1"><img src={`${base}eve/cynosuralBeacon.png`} alt="" className="w-4 h-4 opacity-90" style={{ filter: isDarkMode ? undefined : 'invert(1)' }} />Cyno beacon</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px border-t-2 border-dashed" style={{ borderColor: '#facc15' }}></span>Post-bridge route</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px border-t-2 border-dashed" style={{ borderColor: '#9333ea' }}></span>Titan bridge</span>
      </div>
    </section>
  );
}
