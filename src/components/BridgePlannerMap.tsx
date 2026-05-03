import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GraphData } from '../lib/data';
import { findPathTo } from '../lib/graph';
import { Icon } from './Icon';
import {
  LY_IN_METERS,
  boundsFromIds,
  buildAnsiblexSet,
  buildProjectedSystemMap,
  centerFromBounds,
  fitBoundsScale,
  project2D,
  segmentIntersectsRect,
} from './map/shared';

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
  } catch {
    // Fall back to the media query below if computed styles are unavailable.
  }
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

type Viewport = { zoom: number; pan: { x: number; y: number } };
type ProjectedSystem = { id: number; px: number; py: number; regionId?: number; security?: number };
type GateEdge = { x1: number; y1: number; x2: number; y2: number; interRegion: boolean };
type RouteSegment = { from: number; to: number; type: 'gate' | 'ansi' };
type CynoBeaconMarker = { id: number; px: number; py: number; enabled: boolean };

const secColors = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
const fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

function securityColor(value: number) {
  const idx = value <= 0 ? 0 : Math.min(10, Math.ceil(value * 10));
  return secColors[idx] || secColors[0];
}

function arcControlPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ampScale = 0.22,
  minAmp = 28,
  maxAmp = 140,
) {
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
  return { x: mx + nx * amp, y: my + ny * amp };
}

function drawQuadraticArc(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  ampScale: number,
  minAmp: number,
  maxAmp: number,
  drawArrow = false,
) {
  const ctrl = arcControlPoint(from, to, ampScale, minAmp, maxAmp);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
  ctx.stroke();

  if (!drawArrow) return;
  const angle = Math.atan2(to.y - ctrl.y, to.x - ctrl.x);
  const size = 8;
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#9333ea';
  ctx.translate(to.x, to.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.5);
  ctx.lineTo(-size, size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

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
  const base = import.meta.env?.BASE_URL || '/';
  const [zoomControl, setZoomControl] = useState(1);
  const [resetDisabled, setResetDisabled] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectedPopupRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const hoverLabelRef = useRef<HTMLSpanElement | null>(null);
  const resetAnimationFrameRef = useRef<number | null>(null);
  const drawAnimationFrameRef = useRef<number | null>(null);
  const drawFrameRef = useRef<() => void>(() => {});
  const viewportRef = useRef<Viewport>({ zoom: 1, pan: { x: 0, y: 0 } });
  const zoomControlRef = useRef(1);
  const resetDisabledRef = useRef(true);
  const hoveredIdRef = useRef<number | null>(null);
  const beaconImageRef = useRef<HTMLImageElement | null>(null);
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const viewportResetKeyRef = useRef<string | null>(null);
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

  const routeProjected = useMemo(() => {
    if (!hasRoute || !graph) return new Map<number, { px: number; py: number }>();
    const out = new Map<number, { px: number; py: number }>();
    for (const id of nodeIds) {
      const sys = graph.systems[String(id)];
      if (!sys) continue;
      out.set(id, project2D(sys.position.x, sys.position.y, sys.position.z));
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

  const viewportResetKey = useMemo(() => {
    const fitIds = (fitNodeIds ?? []).filter((id) => Number.isFinite(id)).slice().sort((a, b) => a - b);
    return JSON.stringify({
      stagingId,
      destinationId,
      fitIds,
    });
  }, [destinationId, fitNodeIds, stagingId]);

  const baseScale = useMemo(() => {
    return fitBoundsScale(bounds, w, h, pad);
  }, [bounds]);

  const center = useMemo(() => {
    return centerFromBounds(bounds);
  }, [bounds]);

  const graphGeometry = useMemo(() => {
    const projectedAll = buildProjectedSystemMap(graph);
    const systems: ProjectedSystem[] = [];
    const edges: GateEdge[] = [];
    if (!graph) return { projectedAll, systems, edges };

    for (const [idStr, system] of Object.entries(graph.systems)) {
      const id = Number(idStr);
      const projected = projectedAll.get(id);
      if (!Number.isFinite(id) || !projected) continue;
      systems.push({
        id,
        px: projected.px,
        py: projected.py,
        regionId: system.regionId,
        security: system.security,
      });
    }

    const seen = new Set<string>();
    for (const [idStr, system] of Object.entries(graph.systems)) {
      const id = Number(idStr);
      const from = projectedAll.get(id);
      if (!Number.isFinite(id) || !from) continue;
      for (const next of system.adjacentSystems) {
        const key = id < next ? `${id}-${next}` : `${next}-${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const to = projectedAll.get(next);
        if (!to) continue;
        const nextRegionId = graph.systems[String(next)]?.regionId;
        edges.push({
          x1: from.px,
          y1: from.py,
          x2: to.px,
          y2: to.py,
          interRegion: system.regionId != null && nextRegionId != null && system.regionId !== nextRegionId,
        });
      }
    }

    return { projectedAll, systems, edges };
  }, [graph]);

  const ansiSet = useMemo(
    () => buildAnsiblexSet(settings.allowAnsiblex, settings.ansiblexes, { defaultBidirectional: true }),
    [settings.allowAnsiblex, settings.ansiblexes],
  );

  const routeSegments = useMemo(() => {
    if (approachPaths.length === 0) return [] as RouteSegment[];
    const segs: RouteSegment[] = [];
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
    if (!postBridgePaths || postBridgePaths.length === 0) return [] as RouteSegment[];
    const segs: RouteSegment[] = [];
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

  const cynoBeaconMarkers = useMemo(() => {
    if (!graph || !settings.cynoBeacons?.length) return [] as CynoBeaconMarker[];
    const seen = new Set<number>();
    const markers: CynoBeaconMarker[] = [];
    for (const entry of settings.cynoBeacons) {
      if (!entry) continue;
      const id = Number(entry.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      const projected = graphGeometry.projectedAll.get(id);
      if (!projected) continue;
      markers.push({ id, px: projected.px, py: projected.py, enabled: entry.enabled !== false });
    }
    return markers;
  }, [graph, graphGeometry.projectedAll, settings.cynoBeacons]);

  const startPos = useMemo(() => {
    if (!graph || stagingId == null) return null;
    const system = graph.systems[String(stagingId)];
    if (!system) return null;
    return system.position;
  }, [graph, stagingId]);

  const nameFor = useCallback((id: number) => namesById?.[String(id)] ?? String(id), [namesById]);

  const setLabelRef = useCallback((id: number, node: HTMLSpanElement | null) => {
    if (node) {
      labelRefs.current.set(id, node);
    } else {
      labelRefs.current.delete(id);
    }
  }, []);

  const measureText = useCallback((text: string) => {
    let measured = text.length * 7;
    if (typeof document === 'undefined') return measured;
    if (!measureCtxRef.current) {
      const canvas = document.createElement('canvas');
      measureCtxRef.current = canvas.getContext('2d');
    }
    const ctx = measureCtxRef.current;
    if (ctx) {
      ctx.font = `12px ${fontFamily}`;
      measured = ctx.measureText(text).width;
    }
    return measured;
  }, []);

  const selected = useMemo(() => {
    if (!graph || stagingId == null || startPos == null || selectedId == null) return null;
    const system = graph.systems[String(selectedId)];
    const projected = graphGeometry.projectedAll.get(selectedId) || routeProjected.get(selectedId);
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
    const name = nameFor(selectedId);
    const sVal = typeof system.security === 'number' ? system.security : 0;
    const secColor = securityColor(sVal);
    const secLabel = sVal.toFixed(1);
    const regionName = graph.regionsById?.[String(system.regionId)] ?? String(system.regionId);
    const line = `${name} ${secLabel} • ${regionName} • ${jumps == null ? 'unreachable' : `${jumps}j`} • ${ly.toFixed(2)}ly`;
    const approxWidth = Math.max(40, Math.min(800, Math.ceil(measureText(line) + 18)));
    const approxHeight = 32;
    return { projected, name, regionName, jumps, ly, secColor, secLabel, approxWidth, approxHeight };
  }, [
    bridgeRange,
    graph,
    graphGeometry.projectedAll,
    measureText,
    nameFor,
    routeProjected,
    selectedId,
    settings.allowAnsiblex,
    settings.ansiblexes,
    settings.excludeZarzakh,
    settings.sameRegionOnly,
    stagingId,
    startPos,
  ]);

  const worldToScreen = useCallback((point: { px: number; py: number }, viewport = viewportRef.current) => {
    const scale = baseScale * viewport.zoom;
    return {
      x: (w / 2) + (point.px - center.cx) * scale + viewport.pan.x,
      y: (h / 2) + (point.py - center.cy) * scale + viewport.pan.y,
    };
  }, [baseScale, center.cx, center.cy]);

  const logicalPointFromEvent = useCallback((event: Pick<PointerEvent | ReactPointerEvent<HTMLElement>, 'clientX' | 'clientY'>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (event.clientX - rect.left) * (w / rect.width),
      y: (event.clientY - rect.top) * (h / rect.height),
      rect,
    };
  }, []);

  const prepareCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const width = Math.max(1, Math.round(w * dpr));
    const height = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }, []);

  const findNearestSystem = useCallback((screenX: number, screenY: number) => {
    if (!hasRoute) return null;
    const viewport = viewportRef.current;
    const scale = baseScale * viewport.zoom;
    if (scale <= 0) return null;
    const margin = 8;
    let nearestId: number | null = null;
    let nearestDistance = Infinity;
    for (const system of graphGeometry.systems) {
      const screen = worldToScreen(system, viewport);
      if (screen.x < -margin || screen.x > w + margin || screen.y < -margin || screen.y > h + margin) continue;
      const distance = Math.hypot(screen.x - screenX, screen.y - screenY);
      if (distance <= 6 && distance < nearestDistance) {
        nearestId = system.id;
        nearestDistance = distance;
      }
    }
    return nearestId;
  }, [baseScale, graphGeometry.systems, hasRoute, worldToScreen]);

  const scheduleDraw = useCallback(() => {
    if (drawAnimationFrameRef.current != null || typeof window === 'undefined') return;
    drawAnimationFrameRef.current = window.requestAnimationFrame(() => {
      drawAnimationFrameRef.current = null;
      drawFrameRef.current();
    });
  }, []);

  const syncResetDisabled = useCallback((viewport: Viewport) => {
    const disabled = viewport.zoom === 1 && viewport.pan.x === 0 && viewport.pan.y === 0;
    if (disabled === resetDisabledRef.current) return;
    resetDisabledRef.current = disabled;
    setResetDisabled(disabled);
  }, []);

  const commitViewport = useCallback((viewport: Viewport, options?: { syncZoomControl?: boolean }) => {
    viewportRef.current = viewport;
    syncResetDisabled(viewport);
    if (options?.syncZoomControl && Math.abs(zoomControlRef.current - viewport.zoom) > 0.0001) {
      zoomControlRef.current = viewport.zoom;
      setZoomControl(viewport.zoom);
    }
    scheduleDraw();
  }, [scheduleDraw, syncResetDisabled]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  const cancelViewportAnimation = useCallback(() => {
    if (resetAnimationFrameRef.current == null || typeof window === 'undefined') return;
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
      commitViewport({
        zoom: startZoom + (1 - startZoom) * eased,
        pan: {
          x: startPan.x * (1 - eased),
          y: startPan.y * (1 - eased),
        },
      }, { syncZoomControl: true });
      if (t < 1) {
        resetAnimationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        resetAnimationFrameRef.current = null;
        commitViewport({ zoom: 1, pan: { x: 0, y: 0 } }, { syncZoomControl: true });
      }
    };

    resetAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelViewportAnimation, commitViewport]);

  const handleZoomChange = useCallback((nextZoom: number) => {
    cancelViewportAnimation();
    const currentViewport = viewportRef.current;
    if (currentViewport.zoom <= 0) {
      commitViewport({ zoom: nextZoom, pan: currentViewport.pan }, { syncZoomControl: true });
      return;
    }
    const ratio = nextZoom / currentViewport.zoom;
    commitViewport({
      zoom: nextZoom,
      pan: {
        x: currentViewport.pan.x * ratio,
        y: currentViewport.pan.y * ratio,
      },
    }, { syncZoomControl: true });
  }, [cancelViewportAnimation, commitViewport]);

  useEffect(() => {
    if (!hasBase) {
      viewportResetKeyRef.current = null;
      return;
    }
    if (viewportResetKeyRef.current == null) {
      viewportResetKeyRef.current = viewportResetKey;
      return;
    }
    if (viewportResetKeyRef.current === viewportResetKey) return;
    viewportResetKeyRef.current = viewportResetKey;
    resetViewport();
  }, [hasBase, resetViewport, viewportResetKey]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-map-no-pan="true"]')) return;
    cancelViewportAnimation();
    const currentPan = viewportRef.current.pan;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: currentPan.x,
      startPanY: currentPan.y,
      moved: false,
    };
    suppressClickRef.current = false;
  }, [cancelViewportAnimation]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.moved) return;
    if ((event.target as HTMLElement).closest('[data-map-no-pan="true"]')) return;
    const point = logicalPointFromEvent(event);
    if (!point) return;
    const id = findNearestSystem(point.x, point.y);
    if (id === hoveredIdRef.current) return;
    hoveredIdRef.current = id;
    setHoveredId(id);
  }, [findNearestSystem, logicalPointFromEvent]);

  const handlePointerLeave = useCallback(() => {
    if (dragStateRef.current) return;
    if (hoveredIdRef.current == null) return;
    hoveredIdRef.current = null;
    setHoveredId(null);
  }, []);

  const handleMapClick = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-map-no-pan="true"]')) return;
    if (consumeSuppressedClick()) return;
    const point = logicalPointFromEvent(event);
    const id = point ? findNearestSystem(point.x, point.y) : null;
    setSelectedId((prev) => (id == null ? null : (prev === id ? null : id)));
  }, [consumeSuppressedClick, findNearestSystem, logicalPointFromEvent]);

  const handleMapDoubleClick = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-map-no-pan="true"]')) return;
    if (consumeSuppressedClick()) return;
    const point = logicalPointFromEvent(event);
    const id = point ? findNearestSystem(point.x, point.y) : null;
    if (id != null) onSystemDoubleClick?.(id);
  }, [consumeSuppressedClick, findNearestSystem, logicalPointFromEvent, onSystemDoubleClick]);

  const renderMap = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const backgroundCtx = prepareCanvas(backgroundCanvasRef.current);
    const overlayCtx = prepareCanvas(overlayCanvasRef.current);
    if (!backgroundCtx || !overlayCtx || !hasRoute) return;

    const viewport = viewportRef.current;
    const scale = baseScale * viewport.zoom;
    const marginWorld = scale > 0 ? 10 / scale : 10;
    const xMin = center.cx + (-w / 2 - viewport.pan.x) / scale - marginWorld;
    const xMax = center.cx + (w / 2 - viewport.pan.x) / scale + marginWorld;
    const yMin = center.cy + (-h / 2 - viewport.pan.y) / scale - marginWorld;
    const yMax = center.cy + (h / 2 - viewport.pan.y) / scale + marginWorld;

    const drawLinePath = (ctx: CanvasRenderingContext2D, edges: GateEdge[], interRegion: boolean) => {
      ctx.beginPath();
      for (const edge of edges) {
        if (edge.interRegion !== interRegion) continue;
        if (!segmentIntersectsRect(edge.x1, edge.y1, edge.x2, edge.y2, xMin, yMin, xMax, yMax)) continue;
        const a = worldToScreen({ px: edge.x1, py: edge.y1 }, viewport);
        const b = worldToScreen({ px: edge.x2, py: edge.y2 }, viewport);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    };

    backgroundCtx.save();
    backgroundCtx.lineWidth = 1;
    backgroundCtx.lineCap = 'round';
    backgroundCtx.strokeStyle = '#cbd5f5';
    backgroundCtx.globalAlpha = 0.45;
    backgroundCtx.setLineDash([]);
    drawLinePath(backgroundCtx, graphGeometry.edges, false);
    backgroundCtx.strokeStyle = '#94a3b8';
    backgroundCtx.globalAlpha = 0.35;
    backgroundCtx.setLineDash([6, 6]);
    drawLinePath(backgroundCtx, graphGeometry.edges, true);
    backgroundCtx.setLineDash([]);
    backgroundCtx.globalAlpha = 1;
    backgroundCtx.fillStyle = isDarkMode ? '#64748b' : '#cbd5e1';
    for (const system of graphGeometry.systems) {
      if (system.px < xMin || system.px > xMax || system.py < yMin || system.py > yMax) continue;
      const pt = worldToScreen(system, viewport);
      backgroundCtx.beginPath();
      backgroundCtx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      backgroundCtx.fill();
    }

    const beaconImage = beaconImageRef.current;
    if (beaconImage?.complete && beaconImage.naturalWidth > 0) {
      backgroundCtx.globalAlpha = 1;
      backgroundCtx.filter = isDarkMode ? 'none' : 'invert(1)';
      for (const marker of cynoBeaconMarkers) {
        if (marker.px < xMin || marker.px > xMax || marker.py < yMin || marker.py > yMax) continue;
        const pt = worldToScreen(marker, viewport);
        backgroundCtx.globalAlpha = marker.enabled ? 0.95 : 0.35;
        backgroundCtx.drawImage(beaconImage, pt.x - 8, pt.y - 8, 16, 16);
      }
      backgroundCtx.filter = 'none';
      backgroundCtx.globalAlpha = 1;
    }
    backgroundCtx.restore();

    const projectedFor = (id: number) => routeProjected.get(id) || graphGeometry.projectedAll.get(id) || null;
    const screenFor = (id: number) => {
      const projected = projectedFor(id);
      return projected ? worldToScreen(projected, viewport) : null;
    };

    overlayCtx.save();
    overlayCtx.lineCap = 'round';
    overlayCtx.lineJoin = 'round';

    for (const seg of routeSegments) {
      const a = screenFor(seg.from);
      const b = screenFor(seg.to);
      if (!a || !b) continue;
      overlayCtx.setLineDash([]);
      overlayCtx.strokeStyle = seg.type === 'ansi' ? '#22c55e' : '#facc15';
      overlayCtx.lineWidth = 2.5;
      overlayCtx.globalAlpha = seg.type === 'ansi' ? 0.9 : 0.95;
      if (seg.type === 'ansi') {
        drawQuadraticArc(overlayCtx, a, b, 0.25, 26, 140);
      } else {
        if (!segmentIntersectsRect(a.x, a.y, b.x, b.y, 0, 0, w, h)) continue;
        overlayCtx.beginPath();
        overlayCtx.moveTo(a.x, a.y);
        overlayCtx.lineTo(b.x, b.y);
        overlayCtx.stroke();
      }
    }

    for (const seg of postBridgeSegments) {
      const a = screenFor(seg.from);
      const b = screenFor(seg.to);
      if (!a || !b) continue;
      overlayCtx.setLineDash([4, 4]);
      overlayCtx.strokeStyle = seg.type === 'ansi' ? '#22c55e' : '#facc15';
      overlayCtx.lineWidth = 2;
      overlayCtx.globalAlpha = 0.6;
      if (seg.type === 'ansi') {
        drawQuadraticArc(overlayCtx, a, b, 0.22, 22, 130);
      } else {
        if (!segmentIntersectsRect(a.x, a.y, b.x, b.y, 0, 0, w, h)) continue;
        overlayCtx.beginPath();
        overlayCtx.moveTo(a.x, a.y);
        overlayCtx.lineTo(b.x, b.y);
        overlayCtx.stroke();
      }
    }

    for (let idx = 0; idx < (bridgeLegs ?? []).length; idx++) {
      const leg = bridgeLegs?.[idx];
      if (!leg || leg.parkingId === leg.endpointId) continue;
      const a = screenFor(leg.parkingId);
      const b = screenFor(leg.endpointId);
      if (!a || !b) continue;
      overlayCtx.setLineDash([6, 5]);
      overlayCtx.strokeStyle = '#9333ea';
      overlayCtx.lineWidth = 3;
      overlayCtx.globalAlpha = idx === 0 ? 0.95 : 0.8;
      drawQuadraticArc(overlayCtx, a, b, 0.18, 30, 160, true);
    }

    overlayCtx.globalAlpha = 1;
    overlayCtx.setLineDash([]);
    for (const [id, fill] of focusNodeColors.entries()) {
      const pt = screenFor(id);
      if (!pt || pt.x < -8 || pt.x > w + 8 || pt.y < -8 || pt.y > h + 8) continue;
      overlayCtx.fillStyle = fill;
      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      overlayCtx.fill();
    }

    const positionTextElement = (element: HTMLElement, x: number, y: number) => {
      const cssX = Math.round(x * rect.width / w);
      const cssY = Math.round(y * rect.height / h);
      element.style.left = `${cssX}px`;
      element.style.top = `${cssY}px`;
      element.style.display = 'block';
    };

    for (const id of labelIds) {
      const element = labelRefs.current.get(id);
      const pt = screenFor(id);
      if (!element) continue;
      if (!pt || pt.x < -80 || pt.x > w + 80 || pt.y < -24 || pt.y > h + 24) {
        element.style.display = 'none';
        continue;
      }
      positionTextElement(element, pt.x + 8, pt.y - 22);
    }

    const hoverLabel = hoverLabelRef.current;
    if (hoveredId != null && hoveredId !== selectedId) {
      const projected = graphGeometry.projectedAll.get(hoveredId);
      if (hoverLabel && projected) {
        const pt = worldToScreen(projected, viewport);
        positionTextElement(hoverLabel, pt.x + 8, pt.y - 22);
      }
    } else if (hoverLabel) {
      hoverLabel.style.display = 'none';
    }
    overlayCtx.restore();

    const popup = selectedPopupRef.current;
    if (popup && selected) {
      const pt = worldToScreen(selected.projected, viewport);
      const cssX = (pt.x + 10) * rect.width / w;
      const cssY = Math.round(pt.y - 12) * rect.height / h;
      popup.style.left = `${Math.round(cssX)}px`;
      popup.style.top = `${Math.round(cssY)}px`;
      popup.style.transform = 'none';
    }
  }, [
    baseScale,
    bridgeLegs,
    center.cx,
    center.cy,
    cynoBeaconMarkers,
    focusNodeColors,
    graphGeometry.edges,
    graphGeometry.projectedAll,
    graphGeometry.systems,
    h,
    hasRoute,
    hoveredId,
    isDarkMode,
    labelIds,
    postBridgeSegments,
    prepareCanvas,
    routeProjected,
    routeSegments,
    selected,
    selectedId,
    w,
    worldToScreen,
  ]);

  useLayoutEffect(() => {
    drawFrameRef.current = renderMap;
    scheduleDraw();
  }, [renderMap, scheduleDraw]);

  useEffect(() => {
    return () => {
      if (drawAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(drawAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const image = new Image();
    image.src = `${base}eve/cynosuralBeacon.png`;
    image.onload = scheduleDraw;
    beaconImageRef.current = image;
    return () => {
      image.onload = null;
    };
  }, [base, scheduleDraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => scheduleDraw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const logicalScaleX = rect && rect.width > 0 ? w / rect.width : 1;
      const logicalScaleY = rect && rect.height > 0 ? h / rect.height : 1;
      const dx = (event.clientX - drag.startClientX) * logicalScaleX;
      const dy = (event.clientY - drag.startClientY) * logicalScaleY;
      if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        drag.moved = true;
        suppressClickRef.current = true;
        setIsPanning(true);
        if (hoveredIdRef.current != null) {
          hoveredIdRef.current = null;
          setHoveredId(null);
        }
      }
      if (!drag.moved) return;
      commitViewport({
        ...viewportRef.current,
        pan: { x: drag.startPanX + dx, y: drag.startPanY + dy },
      });
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
  }, [commitViewport]);

  useEffect(() => () => cancelViewportAnimation(), [cancelViewportAnimation]);

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

      <div
        ref={containerRef}
        className={`relative w-full h-[480px] overflow-hidden ${isPanning ? 'cursor-grabbing' : hoveredId != null ? 'cursor-pointer' : 'cursor-grab'}`}
        onClick={handleMapClick}
        onDoubleClick={handleMapDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{ touchAction: 'none' }}
      >
        <div data-map-no-pan="true" className="absolute top-3 right-3 z-20 flex flex-col items-center gap-2">
          <div className="flex h-32 w-10 items-center justify-center">
            <input
              type="range"
              min={60}
              max={220}
              step={5}
              value={Math.round(zoomControl * 100)}
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
            disabled={resetDisabled}
            aria-label="Reset view"
            title="Reset view"
          >
            <Icon name="scope" size={18} />
          </button>
        </div>
        <canvas ref={backgroundCanvasRef} width={w} height={h} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <canvas ref={overlayCanvasRef} width={w} height={h} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 z-10 text-xs text-slate-900 dark:text-slate-100">
          {labelIds.map((id) => (
            <span
              key={`label-${id}`}
              ref={(node) => setLabelRef(id, node)}
              className="absolute whitespace-nowrap leading-4"
              style={{ left: 0, top: 0, fontFamily }}
            >
              {nameFor(id)}
            </span>
          ))}
          {hoveredId != null && hoveredId !== selectedId && (() => {
            const system = graph?.systems[String(hoveredId)];
            const sVal = typeof system?.security === 'number' ? system.security : 0;
            return (
              <span
                ref={hoverLabelRef}
                className="absolute whitespace-nowrap leading-4"
                style={{ left: 0, top: 0, fontFamily }}
              >
                {nameFor(hoveredId)} <span style={{ color: securityColor(sVal), fontWeight: 700 }}>{sVal.toFixed(1)}</span>
              </span>
            );
          })()}
        </div>
        {selected && (
          <div
            ref={selectedPopupRef}
            data-map-no-pan="true"
            onClick={(event) => event.stopPropagation()}
            className="pointer-events-auto absolute z-10 rounded-md border border-solid border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 shadow text-xs leading-5 whitespace-nowrap"
            style={{
              left: 0,
              top: 0,
              width: selected.approxWidth,
              minHeight: selected.approxHeight,
              fontSize: 12,
              fontFamily,
            }}
          >
            <span>{selected.name} </span>
            <span style={{ color: selected.secColor, fontWeight: 700 }}>{selected.secLabel}</span>
            <span>{` • ${selected.regionName} • ${selected.jumps == null ? 'unreachable' : `${selected.jumps}j`} • ${selected.ly.toFixed(2)}ly`}</span>
          </div>
        )}
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
