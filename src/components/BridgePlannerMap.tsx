import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GraphData } from '../lib/data';
import type { RouteStep } from '../lib/bridgeRoutes';
import type { ResolvedAnsiblexEdge } from '../lib/ansiblex';
import {
  ANSIBLEX_ZONE_COLORS, ANSIBLEX_ZONES, classifyAnsiblexSystems,
  getAnsiblexZoneBounds, getAnsiblexZoneGeometry, groupAnsiblexZoneCells, zoneRangeLabel,
  type AnsiblexZoneOverlay, type SystemZone,
} from '../lib/ansiblexZones';
import { findPathTo } from '../lib/graph';
import { Icon } from './Icon';
import {
  LY_IN_METERS,
  type MapBounds,
  boundsFromIds,
  buildProjectedSystemMap,
  centerFromBounds,
  fitBoundsScale,
  project2D,
  rebaseMapViewport,
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
  itinerary: RouteStep[];
  ansiblexEdges: ResolvedAnsiblexEdge[];
  zoneOverlay: AnsiblexZoneOverlay | null;
  onShowZonesChange: (visible: boolean) => void;
  routeContextKey: string;
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

type MapFrame = { bounds: MapBounds; mode: 'route' | 'zones'; capitalId: number | null };

type Viewport = { zoom: number; pan: { x: number; y: number } };
type ProjectedSystem = { id: number; px: number; py: number; regionId?: number; security?: number };
type GateEdge = { x1: number; y1: number; x2: number; y2: number; interRegion: boolean };
type RouteSegment = { from: number; to: number; type: 'gate' | 'ansi' };
type CynoBeaconMarker = { id: number; px: number; py: number; enabled: boolean };

const secColors = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
const fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
const FIT_ANIMATION_DURATION_MS = 240;

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
  itinerary,
  ansiblexEdges,
  zoneOverlay,
  onShowZonesChange,
  routeContextKey,
  fitNodeIds,
  bridgeRange,
  settings,
  statusMessage,
  baselineJumps,
  onSystemDoubleClick,
}: BridgePlannerMapProps) {
  const base = import.meta.env?.BASE_URL || '/';
  const [frame, setFrame] = useState<MapFrame | null>(null);
  const [zoomControl, setZoomControl] = useState(1);
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
  const drawAnimationFrameRef = useRef<number | null>(null);
  const fitAnimationFrameRef = useRef<number | null>(null);
  const drawFrameRef = useRef<() => void>(() => {});
  const viewportRef = useRef<Viewport>({ zoom: 1, pan: { x: 0, y: 0 } });
  const zoomControlRef = useRef(1);
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
  const framedRouteContextRef = useRef<string | null>(null);
  const hasBase = !!graph && stagingId != null && destinationId != null;
  const hasRoute = hasBase && itinerary.length > 0;

  const w = 800;
  const h = 600;
  const pad = 70;
  const nodeIds = useMemo(() => [...new Set(itinerary.flatMap((step) => [step.fromId, step.toId]))], [itinerary]);

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

  const routeBounds = fitBounds ?? selectedBounds;
  const capitalId = zoneOverlay?.capitalId ?? null;
  const zoneRules = zoneOverlay?.rules ?? null;
  const maxZone = zoneOverlay?.maxZone ?? 5;
  const zoneBounds = useMemo(() => getAnsiblexZoneBounds(graph, capitalId), [graph, capitalId]);
  const zoneGeometry = useMemo(() => graph ? getAnsiblexZoneGeometry(graph) : null, [graph]);
  const systemZones = useMemo(() => graph && zoneRules
    ? classifyAnsiblexSystems(graph, capitalId, zoneRules) : new Map<number, SystemZone>(), [graph, capitalId, zoneRules]);
  // A single fill per zone shares cell boundaries without drawing an internal grid.
  // Neither the viewport nor the zone ceiling changes the cached paths.
  const zonePaths = useMemo(() => {
    if (!zoneGeometry) return [];
    return [...groupAnsiblexZoneCells(zoneGeometry, systemZones)].map(([zone, cells]) => {
      const path = new Path2D();
      for (const { polygon } of cells) {
        path.moveTo(polygon[0][0], polygon[0][1]);
        for (let i = 1; i < polygon.length; i++) path.lineTo(polygon[i][0], polygon[i][1]);
        path.closePath();
      }
      return { zone, path };
    });
  }, [zoneGeometry, systemZones]);
  const showZones = !!zoneOverlay?.visible && !!zoneBounds && !!zoneRules;
  const bounds = frame?.bounds ?? zoneBounds ?? routeBounds;
  const canRender = !!graph && !!bounds;

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

  const routeSegments = useMemo<RouteSegment[]>(() => itinerary
    .filter((step) => step.kind !== 'jump')
    .map((step) => ({ from: step.fromId, to: step.toId, type: step.kind === 'ansiblex' ? 'ansi' : 'gate' })), [itinerary]);
  const unknownZoneEdges = useMemo(() => new Set(ansiblexEdges
    .filter((edge) => edge.zone == null)
    .map((edge) => `${edge.from}->${edge.to}`)), [ansiblexEdges]);
  const itineraryAnsiblexes = useMemo(() => itinerary.filter((step) => step.kind === 'ansiblex')
    .map((step) => ansiblexEdges.find((edge) => edge.from === step.fromId && edge.to === step.toId))
    .filter((edge): edge is ResolvedAnsiblexEdge => !!edge), [itinerary, ansiblexEdges]);

  const labelIds = useMemo(() => {
    const ids = new Set<number>();
    if (showZones && capitalId != null) ids.add(capitalId);
    if (hasRoute) {
      if (stagingId != null) ids.add(stagingId);
      if (destinationId != null) ids.add(destinationId);
      for (const leg of bridgeLegs ?? []) {
        ids.add(leg.parkingId);
        ids.add(leg.endpointId);
      }
    }
    return Array.from(ids.values());
  }, [bridgeLegs, destinationId, hasRoute, stagingId, showZones, capitalId]);

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
    if (!graph || selectedId == null) return null;
    const system = graph.systems[String(selectedId)];
    const projected = graphGeometry.projectedAll.get(selectedId) || routeProjected.get(selectedId);
    if (!system || !projected) return null;
    const route = stagingId == null ? null : findPathTo({
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
    const jumps = route?.path ? route.path.length - 1 : null;
    const ly = startPos == null ? null : Math.hypot(
      system.position.x - startPos.x,
      system.position.y - startPos.y,
      system.position.z - startPos.z,
    ) / LY_IN_METERS;
    const name = nameFor(selectedId);
    const sVal = typeof system.security === 'number' ? system.security : 0;
    const secColor = securityColor(sVal);
    const secLabel = sVal.toFixed(1);
    const regionName = graph.regionsById?.[String(system.regionId)] ?? String(system.regionId);
    const line = `${name} ${secLabel} • ${regionName} • ${jumps == null ? 'unreachable' : `${jumps}j`} • ${ly?.toFixed(2) ?? '?'}ly`;
    const approxWidth = Math.max(240, Math.min(800, Math.ceil(measureText(line) + 18)));
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
    if (!canRender) return null;
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
  }, [baseScale, graphGeometry.systems, canRender, worldToScreen]);

  const scheduleDraw = useCallback(() => {
    if (drawAnimationFrameRef.current != null || typeof window === 'undefined') return;
    drawAnimationFrameRef.current = window.requestAnimationFrame(() => {
      drawAnimationFrameRef.current = null;
      drawFrameRef.current();
    });
  }, []);

  const commitViewport = useCallback((viewport: Viewport, options?: { syncZoomControl?: boolean }) => {
    viewportRef.current = viewport;
    if (options?.syncZoomControl && Math.abs(zoomControlRef.current - viewport.zoom) > 0.0001) {
      zoomControlRef.current = viewport.zoom;
      setZoomControl(viewport.zoom);
    }
    scheduleDraw();
  }, [scheduleDraw]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  const cancelViewportAnimation = useCallback(() => {
    if (fitAnimationFrameRef.current == null) return;
    window.cancelAnimationFrame(fitAnimationFrameRef.current);
    fitAnimationFrameRef.current = null;
  }, []);

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

  const fitMap = useCallback((nextBounds: MapBounds, mode: MapFrame['mode']) => {
    cancelViewportAnimation();
    const start = frame && bounds ? rebaseMapViewport(viewportRef.current, bounds, nextBounds, w, h, pad) : null;
    setFrame({ bounds: nextBounds, mode, capitalId });
    if (!start || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || (Math.abs(start.zoom - 1) < 0.0001 && Math.abs(start.pan.x) < 0.01 && Math.abs(start.pan.y) < 0.01)) {
      commitViewport({ zoom: 1, pan: { x: 0, y: 0 } }, { syncZoomControl: true });
      return;
    }
    // Switch frames with an equivalent transform, then ease into the new bounds.
    commitViewport(start, { syncZoomControl: true });
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / FIT_ANIMATION_DURATION_MS);
      const remaining = Math.pow(1 - progress, 3);
      commitViewport({
        zoom: 1 + (start.zoom - 1) * remaining,
        pan: { x: start.pan.x * remaining, y: start.pan.y * remaining },
      }, { syncZoomControl: true });
      fitAnimationFrameRef.current = progress < 1 ? window.requestAnimationFrame(tick) : null;
    };
    fitAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [bounds, cancelViewportAnimation, capitalId, commitViewport, frame]);

  const fitTarget = hasRoute && routeBounds ? { bounds: routeBounds, mode: 'route' as const }
    : zoneBounds ? { bounds: zoneBounds, mode: 'zones' as const } : null;

  useEffect(() => {
    // Freeze the world frame across route results and zone filtering. Only a new
    // journey, a new capital while viewing zones, or an explicit fit reframes it.
    if (zoneBounds && (!frame || (frame.mode === 'zones' && frame.capitalId !== capitalId))) {
      if (hasRoute) framedRouteContextRef.current = routeContextKey;
      fitMap(zoneBounds, 'zones');
    } else if (hasRoute && routeBounds && framedRouteContextRef.current !== routeContextKey) {
      framedRouteContextRef.current = routeContextKey;
      fitMap(routeBounds, 'route');
    }
  }, [capitalId, fitMap, frame, hasRoute, routeBounds, routeContextKey, zoneBounds]);

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
    if (!backgroundCtx || !overlayCtx || !canRender) return;

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

    if (showZones) {
      backgroundCtx.save();
      backgroundCtx.translate(w / 2 + viewport.pan.x - center.cx * scale, h / 2 + viewport.pan.y - center.cy * scale);
      backgroundCtx.scale(scale * LY_IN_METERS, scale * LY_IN_METERS);
      for (const { zone, path } of zonePaths) {
        backgroundCtx.fillStyle = ANSIBLEX_ZONE_COLORS[zone];
        backgroundCtx.globalAlpha = zone <= maxZone ? (isDarkMode ? 0.2 : 0.17) : 0.045;
        backgroundCtx.fill(path);
      }
      backgroundCtx.restore();
    }

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
    for (const system of graphGeometry.systems) {
      if (system.px < xMin || system.px > xMax || system.py < yMin || system.py > yMax) continue;
      const pt = worldToScreen(system, viewport);
      const zone = showZones ? systemZones.get(system.id)?.zone : null;
      backgroundCtx.fillStyle = zone ? ANSIBLEX_ZONE_COLORS[zone] : isDarkMode ? '#64748b' : '#94a3b8';
      backgroundCtx.globalAlpha = zone && zone > maxZone ? 0.35 : 0.9;
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
      const unknownZone = unknownZoneEdges.has(`${seg.from}->${seg.to}`);
      overlayCtx.strokeStyle = seg.type === 'ansi' ? unknownZone ? '#f59e0b' : '#22c55e' : '#facc15';
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

    if (showZones && capitalId != null) {
      const pt = screenFor(capitalId);
      if (pt) {
        overlayCtx.fillStyle = '#fbbf24';
        overlayCtx.strokeStyle = isDarkMode ? '#0f172a' : '#ffffff';
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        for (let i = 0; i < 10; i++) {
          const angle = -Math.PI / 2 + i * Math.PI / 5;
          const radius = i % 2 === 0 ? 10 : 4.5;
          const x = pt.x + Math.cos(angle) * radius;
          const y = pt.y + Math.sin(angle) * radius;
          if (i === 0) overlayCtx.moveTo(x, y);
          else overlayCtx.lineTo(x, y);
        }
        overlayCtx.closePath();
        overlayCtx.fill();
        overlayCtx.stroke();
      }
    }

    const positionTextElement = (element: HTMLElement, x: number, y: number) => {
      const cssX = Math.max(4, Math.min(rect.width - element.offsetWidth - 4, Math.round(x * rect.width / w)));
      const cssY = Math.max(4, Math.min(rect.height - element.offsetHeight - 4, Math.round(y * rect.height / h)));
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
      popup.style.left = `${Math.max(4, Math.min(rect.width - popup.offsetWidth - 4, Math.round(cssX)))}px`;
      popup.style.top = `${Math.max(4, Math.min(rect.height - popup.offsetHeight - 4, Math.round(cssY)))}px`;
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
    canRender,
    showZones,
    capitalId,
    maxZone,
    systemZones,
    zonePaths,
    hoveredId,
    isDarkMode,
    labelIds,
    unknownZoneEdges,
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
      cancelViewportAnimation();
      if (drawAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(drawAnimationFrameRef.current);
        drawAnimationFrameRef.current = null;
      }
    };
  }, [cancelViewportAnimation]);

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
  }, [scheduleDraw, canRender]);

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

  const capitalName = capitalId == null ? null : nameFor(capitalId);
  const selectedZone = selectedId == null ? null : systemZones.get(selectedId);

  return (
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700" aria-label="Planner map">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-medium">Map</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {zoneOverlay && <>
            <label className="inline-flex items-center gap-2 cursor-pointer rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1.5">
              <input type="checkbox" checked={zoneOverlay.visible} onChange={(event) => onShowZonesChange(event.target.checked)} className="peer sr-only" />
              <span aria-hidden="true" className="relative h-4 w-7 rounded-full bg-slate-300 transition-colors peer-checked:bg-teal-500 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-400 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-3 dark:bg-slate-700" />Show zones
            </label>
          </>}
        </div>
      </div>
      {zoneOverlay && (!zoneBounds || !zoneRules) && <p role="status" className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {!zoneRules ? 'Loading Ansiblex zones…' : 'Configure an Ansiblex network or sign in to locate its capital and show zones.'}
      </p>}
      {!hasRoute && <div className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        <p>{!hasBase ? 'Select a staging system and destination to plan a route.' : statusMessage || 'No route to display yet.'}</p>
        {baselineJumps != null && <p>Direct route: {baselineJumps}j without bridge</p>}
      </div>}

      {canRender && <>
      <div
        ref={containerRef}
        aria-label="System map; drag to pan, click a system for details"
        className={`relative w-full h-[360px] sm:h-[480px] overflow-hidden rounded-md ${isPanning ? 'cursor-grabbing' : hoveredId != null ? 'cursor-pointer' : 'cursor-grab'}`}
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
            onClick={() => { if (fitTarget) fitMap(fitTarget.bounds, fitTarget.mode); }}
            disabled={!fitTarget}
            aria-label="Fit map"
            title="Fit map"
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
              className="absolute whitespace-nowrap leading-4 rounded bg-white/75 dark:bg-slate-950/70 px-1"
              style={{ left: 0, top: 0, fontFamily }}
            >
              {showZones && id === capitalId ? '★ ' : ''}{nameFor(id)}{showZones && id === capitalId ? ' · Capital' : ''}
            </span>
          ))}
          {hoveredId != null && hoveredId !== selectedId && (() => {
            const system = graph?.systems[String(hoveredId)];
            const sVal = typeof system?.security === 'number' ? system.security : 0;
            const zone = systemZones.get(hoveredId);
            return (
              <span
                ref={hoverLabelRef}
                role="tooltip"
                className="absolute max-w-[90%] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 px-2 py-1 leading-4 shadow"
                style={{ left: 0, top: 0, fontFamily }}
              >
                {nameFor(hoveredId)} <span style={{ color: securityColor(sVal), fontWeight: 700 }}>{sVal.toFixed(1)}</span>
                {zoneOverlay && <span className="block">{zone ? `Zone ${zone.zone} · ${zone.distanceLy.toFixed(2)} LY from ${capitalName}` : 'Zone unknown · capital unavailable'}</span>}
              </span>
            );
          })()}
        </div>
        {selected && (
          <div
            ref={selectedPopupRef}
            data-map-no-pan="true"
            onClick={(event) => event.stopPropagation()}
            className="pointer-events-auto absolute z-10 rounded-md border border-solid border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 shadow text-xs leading-5"
            style={{
              left: 0,
              top: 0,
              width: Math.min(360, selected.approxWidth),
              maxWidth: '90%',
              minHeight: selected.approxHeight,
              fontSize: 12,
              fontFamily,
            }}
          >
            <span>{selected.name} </span>
            <span style={{ color: selected.secColor, fontWeight: 700 }}>{selected.secLabel}</span>
            <span>{` • ${selected.regionName}`}{selected.ly != null ? ` • ${selected.jumps == null ? 'unreachable' : `${selected.jumps}j`} • ${selected.ly.toFixed(2)} LY from staging` : ''}</span>
            {zoneOverlay && <p className="mt-1">{selectedZone ? `Zone ${selectedZone.zone} · ${selectedZone.distanceLy.toFixed(2)} LY from ${capitalName}` : 'Zone unknown · capital unavailable'}</p>}
            {itineraryAnsiblexes.filter((edge) => edge.from === selectedId).map((edge, index) => (
              <div key={`${edge.from}-${edge.to}-${index}`} className="mt-1 text-xs">
                Ansiblex → {nameFor(edge.to)} · {edge.zone == null ? 'Zone unknown' : `Zone ${edge.zone}`}
              </div>
            ))}
          </div>
        )}
      </div>

      {hasRoute && <div className="text-xs text-gray-600 dark:text-gray-400 mt-3 flex flex-wrap gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#2563eb' }}></span>Staging</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#f59e0b' }}></span>Parking systems</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }}></span>Destination</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#a855f7' }}></span>Bridge endpoints</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: '#facc15' }}></span>Gates</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px" style={{ background: '#22c55e' }}></span>Ansiblex</span>
        {itineraryAnsiblexes.some((edge) => edge.zone == null) && <span className="text-amber-600 dark:text-amber-400">Amber: zone unknown</span>}
        <span className="inline-flex items-center gap-1"><img src={`${base}eve/cynosuralBeacon.png`} alt="" className="w-4 h-4 opacity-90" style={{ filter: isDarkMode ? undefined : 'invert(1)' }} />Cyno beacon</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-px border-t-2 border-dashed" style={{ borderColor: '#9333ea' }}></span>Titan bridge</span>
      </div>}
      </>}
      {showZones && zoneRules && <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-3 text-xs" aria-label="Ansiblex zone legend">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="font-medium"><span className="text-amber-500">★</span> {capitalName} <span className="font-normal text-slate-500 dark:text-slate-400">· {zoneOverlay?.allianceName ?? 'Alliance unknown'}</span></p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{zoneOverlay?.referenceLabel}</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2">
          {ANSIBLEX_ZONES.map((zone) => <div key={zone} className={`min-w-0 rounded-lg border px-2 py-2 sm:px-3 ${zone > maxZone ? 'opacity-40' : ''}`}
            style={{ borderColor: `${ANSIBLEX_ZONE_COLORS[zone]}35`, backgroundColor: `${ANSIBLEX_ZONE_COLORS[zone]}0a` }}>
            <div className="mb-1.5 h-0.5 w-5 rounded-full" style={{ background: ANSIBLEX_ZONE_COLORS[zone] }} />
            <span className="font-semibold">Zone {zone}</span>
            <div className="mt-0.5 whitespace-nowrap text-[10px] sm:text-xs text-slate-600 dark:text-slate-300">{zoneRangeLabel(zone, zoneRules)}</div>
            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{zone <= maxZone ? 'Allowed' : 'Excluded'}</div>
          </div>)}
        </div>
        <p className="mt-2 text-slate-500">Areas group systems by 3D distance to {capitalName}; they are not sovereignty borders. Ansiblex limits use each departure owner’s capital.</p>
      </div>}
    </section>
  );
}
