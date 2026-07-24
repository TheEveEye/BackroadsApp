import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { GraphData, SystemNode } from '../lib/data';
import { Icon } from './Icon';

type MapMode = 'schematic' | 'geographic';
type Viewport = {
  zoom: number;
  panX: number;
  panY: number;
};
type MapPoint = {
  id: number;
  x: number;
  y: number;
  security: number;
  eligible: boolean;
};
type MapEdge = {
  from: MapPoint;
  to: MapPoint;
  interRegion: boolean;
  interConstellation: boolean;
};
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  moved: boolean;
};
type LassoState = {
  pointerId: number;
  points: Array<{ x: number; y: number }>;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 16;
const MAP_PADDING = 48;
const PROJECTION_ANIMATION_MS = 560;
const INITIAL_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };
const SECURITY_COLORS = [
  '#833862',
  '#692623',
  '#AC2822',
  '#BD4E26',
  '#CC722C',
  '#F5FD93',
  '#90E56A',
  '#82D8A8',
  '#73CBF3',
  '#5698E5',
  '#4173DB',
];

function getIsDarkMode() {
  return typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    : false;
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function getProjectedPosition(system: SystemNode, projectionMix: number) {
  const geographicX = system.position.x;
  const geographicY = system.position.z;
  const schematicX = Number.isFinite(system.position2D?.x) ? system.position2D!.x : geographicX;
  const schematicY = Number.isFinite(system.position2D?.y) ? system.position2D!.y : geographicY;
  if (
    !Number.isFinite(geographicX)
    || !Number.isFinite(geographicY)
    || !Number.isFinite(schematicX)
    || !Number.isFinite(schematicY)
  ) return null;
  return {
    x: schematicX + (geographicX - schematicX) * projectionMix,
    y: -(schematicY + (geographicY - schematicY) * projectionMix),
  };
}

function getProjectionFitViewport(
  graph: GraphData | null,
  projectionMix: number,
  selectedSystemIds: ReadonlySet<number>,
  size: { width: number; height: number },
): Viewport {
  if (!graph || selectedSystemIds.size === 0) return INITIAL_VIEWPORT;

  let mapMinX = Infinity;
  let mapMaxX = -Infinity;
  let mapMinY = Infinity;
  let mapMaxY = -Infinity;
  let selectedMinX = Infinity;
  let selectedMaxX = -Infinity;
  let selectedMinY = Infinity;
  let selectedMaxY = -Infinity;
  let selectedCount = 0;

  for (const system of Object.values(graph.systems)) {
    const position = getProjectedPosition(system, projectionMix);
    if (!position) continue;
    mapMinX = Math.min(mapMinX, position.x);
    mapMaxX = Math.max(mapMaxX, position.x);
    mapMinY = Math.min(mapMinY, position.y);
    mapMaxY = Math.max(mapMaxY, position.y);
    if (!selectedSystemIds.has(system.systemId)) continue;
    selectedMinX = Math.min(selectedMinX, position.x);
    selectedMaxX = Math.max(selectedMaxX, position.x);
    selectedMinY = Math.min(selectedMinY, position.y);
    selectedMaxY = Math.max(selectedMaxY, position.y);
    selectedCount += 1;
  }

  if (!Number.isFinite(mapMinX) || selectedCount === 0) return INITIAL_VIEWPORT;
  const mapSpanX = Math.max(1, mapMaxX - mapMinX);
  const mapSpanY = Math.max(1, mapMaxY - mapMinY);
  const mapWidth = Math.max(1, size.width - MAP_PADDING * 2);
  const mapHeight = Math.max(1, size.height - MAP_PADDING * 2);
  const baseScale = Math.min(mapWidth / mapSpanX, mapHeight / mapSpanY);
  const selectionPadding = MAP_PADDING + 20;
  const selectionWidth = Math.max(1, size.width - selectionPadding * 2);
  const selectionHeight = Math.max(1, size.height - selectionPadding * 2);
  const selectedSpanX = selectedMaxX - selectedMinX;
  const selectedSpanY = selectedMaxY - selectedMinY;
  const targetScale = selectedCount === 1
    ? baseScale * 6
    : Math.min(
      selectedSpanX > 0 ? selectionWidth / selectedSpanX : Infinity,
      selectedSpanY > 0 ? selectionHeight / selectedSpanY : Infinity,
    );
  const zoom = clampZoom(Number.isFinite(targetScale) ? targetScale / baseScale : 6);
  const mapCenterX = (mapMinX + mapMaxX) / 2;
  const mapCenterY = (mapMinY + mapMaxY) / 2;
  const selectedCenterX = (selectedMinX + selectedMaxX) / 2;
  const selectedCenterY = (selectedMinY + selectedMaxY) / 2;

  return {
    zoom,
    panX: -(selectedCenterX - mapCenterX) * baseScale * zoom,
    panY: -(selectedCenterY - mapCenterY) * baseScale * zoom,
  };
}

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects = (
      (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (
        (previousPoint.x - currentPoint.x)
        * (point.y - currentPoint.y)
        / (previousPoint.y - currentPoint.y)
        + currentPoint.x
      )
    );
    if (intersects) inside = !inside;
  }
  return inside;
}

type SovereigntyPlannerMapProps = {
  graph: GraphData | null;
  selectedSystemIds: ReadonlySet<number>;
  onToggleSystem: (systemId: number) => void;
  territoryEditing: boolean;
  onLassoSelection: (systemIds: number[]) => void;
  fitSelectionRequest: number;
};

export function SovereigntyPlannerMap({
  graph,
  selectedSystemIds,
  onToggleSystem,
  territoryEditing,
  onLassoSelection,
  fitSelectionRequest,
}: SovereigntyPlannerMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lassoRef = useRef<LassoState | null>(null);
  const resetAnimationFrameRef = useRef<number | null>(null);
  const projectionAnimationFrameRef = useRef<number | null>(null);
  const lastFitSelectionRequestRef = useRef(0);
  const [mode, setMode] = useState<MapMode>('schematic');
  const [projectionMix, setProjectionMix] = useState(0);
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const [hovered, setHovered] = useState<{ id: number; x: number; y: number } | null>(null);
  const [lassoPoints, setLassoPoints] = useState<Array<{ x: number; y: number }>>([]);

  const schematicCount = useMemo(() => {
    if (!graph) return 0;
    return Object.values(graph.systems).filter((system) => (
      Number.isFinite(system.position2D?.x) && Number.isFinite(system.position2D?.y)
    )).length;
  }, [graph]);
  const hasSchematicCoordinates = schematicCount > 0;

  useEffect(() => {
    if (graph && !hasSchematicCoordinates && mode === 'schematic') {
      setMode('geographic');
      setProjectionMix(1);
    }
  }, [graph, hasSchematicCoordinates, mode]);

  const geometry = useMemo(() => {
    const points: MapPoint[] = [];
    const pointsById = new Map<number, MapPoint>();
    const edges: MapEdge[] = [];
    if (!graph) {
      return {
        points,
        edges,
        bounds: null as { minX: number; maxX: number; minY: number; maxY: number } | null,
      };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [idString, system] of Object.entries(graph.systems)) {
      const id = Number(idString);
      const position = getProjectedPosition(system, projectionMix);
      if (!Number.isFinite(id) || !position) continue;

      const point = {
        id,
        x: position.x,
        y: position.y,
        security: typeof system.security === 'number' ? system.security : 0,
        eligible: system.isSovereigntyEligible,
      };
      points.push(point);
      pointsById.set(id, point);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    const seenEdges = new Set<string>();
    for (const [idString, system] of Object.entries(graph.systems)) {
      const id = Number(idString);
      const from = pointsById.get(id);
      if (!from) continue;
      for (const neighborId of system.adjacentSystems) {
        const edgeKey = id < neighborId ? `${id}-${neighborId}` : `${neighborId}-${id}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        const to = pointsById.get(neighborId);
        if (!to) continue;
        edges.push({
          from,
          to,
          interRegion: system.regionId !== graph.systems[String(neighborId)]?.regionId,
          interConstellation: (
            system.regionId === graph.systems[String(neighborId)]?.regionId
            && system.constellationId !== graph.systems[String(neighborId)]?.constellationId
          ),
        });
      }
    }

    const bounds = Number.isFinite(minX) && Number.isFinite(minY)
      ? { minX, maxX, minY, maxY }
      : null;
    return { points, edges, bounds };
  }, [graph, projectionMix]);

  const baseTransform = useMemo(() => {
    const bounds = geometry.bounds;
    if (!bounds) {
      return {
        scale: 1,
        centerX: 0,
        centerY: 0,
      };
    }

    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const usableWidth = Math.max(1, size.width - MAP_PADDING * 2);
    const usableHeight = Math.max(1, size.height - MAP_PADDING * 2);
    return {
      scale: Math.min(usableWidth / spanX, usableHeight / spanY),
      centerX: (bounds.minX + bounds.maxX) / 2,
      centerY: (bounds.minY + bounds.maxY) / 2,
    };
  }, [geometry.bounds, size.height, size.width]);

  const transform = useMemo(() => ({
    scale: baseTransform.scale * viewport.zoom,
    centerX: baseTransform.centerX,
    centerY: baseTransform.centerY,
    screenX: size.width / 2 + viewport.panX,
    screenY: size.height / 2 + viewport.panY,
  }), [baseTransform, size.height, size.width, viewport]);

  const fitTargetViewport = useMemo(
    () => getProjectionFitViewport(graph, projectionMix, selectedSystemIds, size),
    [graph, projectionMix, selectedSystemIds, size],
  );

  const pointToScreen = useCallback((point: Pick<MapPoint, 'x' | 'y'>) => ({
    x: transform.screenX + (point.x - transform.centerX) * transform.scale,
    y: transform.screenY + (point.y - transform.centerY) * transform.scale,
  }), [transform]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    context.save();
    context.lineCap = 'round';
    const hasSelection = selectedSystemIds.size > 0;
    const isProminentEdge = (edge: MapEdge) => (
      hasSelection
        ? selectedSystemIds.has(edge.from.id) && selectedSystemIds.has(edge.to.id)
        : edge.from.eligible && edge.to.eligible
    );
    const drawEdges = (
      prominent: boolean,
      boundary: 'system' | 'constellation' | 'region',
    ) => {
      const interRegion = boundary === 'region';
      const interConstellation = boundary === 'constellation';
      context.lineWidth = prominent ? 1 : 0.65;
      context.strokeStyle = '#64748b';
      context.globalAlpha = prominent
        ? (interRegion ? 0.68 : interConstellation ? 0.56 : 0.48)
        : hasSelection ? 0.07 : 0.13;
      context.setLineDash(interRegion ? [7, 4] : interConstellation ? [1.5, 3] : []);
      context.beginPath();
      for (const edge of geometry.edges) {
        if (
          edge.interRegion !== interRegion
          || edge.interConstellation !== interConstellation
          || isProminentEdge(edge) !== prominent
        ) continue;
        const from = pointToScreen(edge.from);
        const to = pointToScreen(edge.to);
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
      }
      context.stroke();
    };
    drawEdges(false, 'system');
    drawEdges(false, 'constellation');
    drawEdges(false, 'region');
    drawEdges(true, 'system');
    drawEdges(true, 'constellation');
    drawEdges(true, 'region');

    context.setLineDash([]);
    for (const point of geometry.points) {
      const screen = pointToScreen(point);
      if (screen.x < -6 || screen.x > size.width + 6 || screen.y < -6 || screen.y > size.height + 6) continue;
      const selected = selectedSystemIds.has(point.id);
      const security = Math.max(0, Math.min(1, point.security));
      const hue = 4 + security * 205;
      context.globalAlpha = selected
        ? 1
        : point.eligible
          ? hasSelection ? 0.17 : 0.9
          : hasSelection ? 0.045 : 0.12;
      context.fillStyle = `hsl(${hue} 72% ${isDarkMode ? 62 : 42}%)`;
      context.beginPath();
      context.arc(
        screen.x,
        screen.y,
        selected ? 2.8 : viewport.zoom >= 4 ? 2.1 : point.eligible ? 1.55 : 1.2,
        0,
        Math.PI * 2,
      );
      context.fill();
      if (selected) {
        context.strokeStyle = isDarkMode ? '#f8fafc' : '#0f172a';
        context.globalAlpha = 0.7;
        context.lineWidth = 0.9;
        context.beginPath();
        context.arc(screen.x, screen.y, 4.5, 0, Math.PI * 2);
        context.stroke();
      }
    }

    if (hovered) {
      const point = geometry.points.find((candidate) => candidate.id === hovered.id);
      if (point) {
        const screen = pointToScreen(point);
        context.strokeStyle = isDarkMode ? '#f8fafc' : '#0f172a';
        context.globalAlpha = 1;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
        context.stroke();
      }
    }

    if (lassoPoints.length > 1) {
      context.strokeStyle = isDarkMode ? '#c4b5fd' : '#7c3aed';
      context.fillStyle = isDarkMode ? 'rgba(139, 92, 246, 0.16)' : 'rgba(124, 58, 237, 0.11)';
      context.globalAlpha = 1;
      context.lineWidth = 2;
      context.setLineDash([5, 3]);
      context.beginPath();
      context.moveTo(lassoPoints[0].x, lassoPoints[0].y);
      for (const point of lassoPoints.slice(1)) {
        context.lineTo(point.x, point.y);
      }
      if (lassoPoints.length > 2) {
        context.closePath();
        context.fill();
      }
      context.stroke();
    }
    context.restore();
  }, [
    geometry.edges,
    geometry.points,
    hovered,
    isDarkMode,
    lassoPoints,
    pointToScreen,
    selectedSystemIds,
    size.height,
    size.width,
    viewport.zoom,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDarkMode(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const cancelViewportAnimation = useCallback(() => {
    if (resetAnimationFrameRef.current == null) return;
    window.cancelAnimationFrame(resetAnimationFrameRef.current);
    resetAnimationFrameRef.current = null;
  }, []);

  const cancelProjectionAnimation = useCallback(() => {
    if (projectionAnimationFrameRef.current == null) return;
    window.cancelAnimationFrame(projectionAnimationFrameRef.current);
    projectionAnimationFrameRef.current = null;
  }, []);

  const animateViewportTo = useCallback((target: Viewport) => {
    setHovered(null);
    if (
      Math.abs(viewport.zoom - target.zoom) < 0.001
      && Math.abs(viewport.panX - target.panX) < 0.1
      && Math.abs(viewport.panY - target.panY) < 0.1
    ) return;
    cancelViewportAnimation();

    const startViewport = viewport;
    const startedAt = performance.now();
    const durationMs = 240;
    const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = easeOutCubic(progress);
      setViewport({
        zoom: startViewport.zoom + (target.zoom - startViewport.zoom) * eased,
        panX: startViewport.panX + (target.panX - startViewport.panX) * eased,
        panY: startViewport.panY + (target.panY - startViewport.panY) * eased,
      });

      if (progress < 1) {
        resetAnimationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        resetAnimationFrameRef.current = null;
        setViewport(target);
      }
    };

    resetAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelViewportAnimation, viewport]);

  const resetView = useCallback(() => {
    animateViewportTo(fitTargetViewport);
  }, [animateViewportTo, fitTargetViewport]);

  useEffect(() => {
    if (fitSelectionRequest === lastFitSelectionRequestRef.current) return;
    lastFitSelectionRequestRef.current = fitSelectionRequest;
    animateViewportTo(fitTargetViewport);
  }, [animateViewportTo, fitSelectionRequest, fitTargetViewport]);

  useEffect(() => () => {
    cancelViewportAnimation();
    cancelProjectionAnimation();
  }, [cancelProjectionAnimation, cancelViewportAnimation]);

  const changeMode = useCallback((nextMode: MapMode) => {
    if (
      nextMode === mode
      || (nextMode === 'schematic' && !hasSchematicCoordinates)
    ) return;
    cancelProjectionAnimation();
    cancelViewportAnimation();
    lassoRef.current = null;
    setLassoPoints([]);
    setMode(nextMode);
    setHovered(null);

    const startMix = projectionMix;
    const targetMix = nextMode === 'geographic' ? 1 : 0;
    const startViewport = viewport;
    const targetViewport = getProjectionFitViewport(
      graph,
      targetMix,
      selectedSystemIds,
      size,
    );
    const startedAt = performance.now();
    const easeInOutCubic = (progress: number) => (
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2
    );

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / PROJECTION_ANIMATION_MS);
      const eased = easeInOutCubic(progress);
      setProjectionMix(startMix + (targetMix - startMix) * eased);
      setViewport({
        zoom: startViewport.zoom + (targetViewport.zoom - startViewport.zoom) * eased,
        panX: startViewport.panX + (targetViewport.panX - startViewport.panX) * eased,
        panY: startViewport.panY + (targetViewport.panY - startViewport.panY) * eased,
      });
      if (progress < 1) {
        projectionAnimationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        projectionAnimationFrameRef.current = null;
        setProjectionMix(targetMix);
        setViewport(targetViewport);
      }
    };

    projectionAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [
    cancelProjectionAnimation,
    cancelViewportAnimation,
    graph,
    hasSchematicCoordinates,
    mode,
    projectionMix,
    selectedSystemIds,
    size,
    viewport,
  ]);

  const zoomAt = useCallback((nextZoom: number, anchorX = size.width / 2, anchorY = size.height / 2) => {
    cancelViewportAnimation();
    setViewport((current) => {
      const zoom = clampZoom(nextZoom);
      const ratio = zoom / current.zoom;
      return {
        zoom,
        panX: anchorX - size.width / 2 - (anchorX - size.width / 2 - current.panX) * ratio,
        panY: anchorY - size.height / 2 - (anchorY - size.height / 2 - current.panY) * ratio,
      };
    });
    setHovered(null);
  }, [cancelViewportAnimation, size.height, size.width]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(viewport.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
  }, [viewport.zoom, zoomAt]);

  const findNearestSystem = useCallback((
    pointerX: number,
    pointerY: number,
    eligibleOnly: boolean,
  ) => {
    let nearest: { id: number; x: number; y: number; distance: number } | null = null;
    for (const point of geometry.points) {
      if (eligibleOnly && !point.eligible) continue;
      const screen = pointToScreen(point);
      const distance = Math.hypot(screen.x - pointerX, screen.y - pointerY);
      if (distance <= 8 && (!nearest || distance < nearest.distance)) {
        nearest = { id: point.id, x: screen.x, y: screen.y, distance };
      }
    }
    return nearest;
  }, [geometry.points, pointToScreen]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-map-control]')) return;
    cancelViewportAnimation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    if (territoryEditing && event.altKey) {
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const lasso = {
        pointerId: event.pointerId,
        points: [point],
      };
      lassoRef.current = lasso;
      setLassoPoints(lasso.points);
      setHovered(null);
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: viewport.panX,
      startPanY: viewport.panY,
      moved: false,
    };
    setIsPanning(true);
    setHovered(null);
  }, [cancelViewportAnimation, territoryEditing, viewport.panX, viewport.panY]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const lasso = lassoRef.current;
    if (lasso?.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const previous = lasso.points[lasso.points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 4) {
        const points = [...lasso.points, point];
        lassoRef.current = { ...lasso, points };
        setLassoPoints(points);
      }
      return;
    }

    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) >= 4) {
        drag.moved = true;
      }
      if (!drag.moved) return;
      setViewport((current) => ({
        ...current,
        panX: drag.startPanX + deltaX,
        panY: drag.startPanY + deltaY,
      }));
      return;
    }
    if ((event.target as HTMLElement).closest('[data-map-control]')) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const nearest = findNearestSystem(pointerX, pointerY, false);
    setHovered(nearest ? { id: nearest.id, x: nearest.x, y: nearest.y } : null);
  }, [findNearestSystem]);

  const finishPointerInteraction = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const lasso = lassoRef.current;
    if (lasso?.pointerId === event.pointerId) {
      if (lasso.points.length >= 3) {
        const enclosedSystemIds = geometry.points
          .filter((point) => point.eligible && pointInPolygon(pointToScreen(point), lasso.points))
          .map((point) => point.id);
        if (enclosedSystemIds.length > 0) {
          onLassoSelection(enclosedSystemIds);
        }
      }
      lassoRef.current = null;
      setLassoPoints([]);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      const rect = event.currentTarget.getBoundingClientRect();
      const nearest = findNearestSystem(
        event.clientX - rect.left,
        event.clientY - rect.top,
        true,
      );
      if (territoryEditing && nearest) onToggleSystem(nearest.id);
    }
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [
    findNearestSystem,
    geometry.points,
    onLassoSelection,
    onToggleSystem,
    pointToScreen,
    territoryEditing,
  ]);

  const cancelPointerInteraction = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (lassoRef.current?.pointerId === event.pointerId) {
      lassoRef.current = null;
      setLassoPoints([]);
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsPanning(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    if (!territoryEditing) {
      setIsAltPressed(false);
      lassoRef.current = null;
      setLassoPoints([]);
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setIsAltPressed(true);
      if (event.key === 'Escape' && lassoRef.current) {
        lassoRef.current = null;
        setLassoPoints([]);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setIsAltPressed(false);
    };
    const handleWindowBlur = () => setIsAltPressed(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [territoryEditing]);

  const hoveredSystem = hovered && graph?.systems[String(hovered.id)];
  const hoveredName = hovered ? graph?.namesById?.[String(hovered.id)] ?? String(hovered.id) : null;
  const hoveredSecurity = typeof hoveredSystem?.security === 'number' ? hoveredSystem.security : 0;
  const hoveredSecurityIndex = hoveredSecurity <= 0
    ? 0
    : Math.min(10, Math.ceil(hoveredSecurity * 10));
  const hoveredSecurityColor = SECURITY_COLORS[hoveredSecurityIndex] ?? SECURITY_COLORS[0];
  const hoverTooltipWidth = Math.min(260, Math.max(72, (hoveredName?.length ?? 0) * 7 + 44));
  const isAtFitTarget = (
    Math.abs(viewport.zoom - fitTargetViewport.zoom) < 0.001
    && Math.abs(viewport.panX - fitTargetViewport.panX) < 0.1
    && Math.abs(viewport.panY - fitTargetViewport.panY) < 0.1
  );
  const cursorClass = territoryEditing && (isAltPressed || lassoPoints.length > 0)
    ? 'cursor-crosshair'
    : isPanning
      ? 'cursor-grabbing'
      : territoryEditing && hoveredSystem?.isSovereigntyEligible
        ? 'cursor-pointer'
        : 'cursor-grab';

  return (
    <section className="flex h-full min-h-[520px] flex-col rounded-lg border border-gray-200 bg-white/50 p-4 dark:border-gray-700 dark:bg-black/20">
      <div
        ref={containerRef}
        className={`relative min-h-0 w-full flex-1 overflow-hidden rounded-md touch-none select-none ${cursorClass}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={cancelPointerInteraction}
        onPointerLeave={() => {
          if (!dragRef.current && !lassoRef.current) setHovered(null);
        }}
        role="application"
        aria-label={lassoPoints.length > 0
          ? 'Sovereignty map. Draw around systems to change the territory selection. Press Escape to cancel.'
          : territoryEditing
            ? 'Sovereignty map. Click systems to change the territory selection, hold Alt or Option and drag to lasso, drag normally to pan, and use the mouse wheel or map controls to zoom.'
            : 'Sovereignty map. Drag to pan and use the mouse wheel or map controls to zoom.'}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        <div data-map-control className="absolute right-3 top-3 z-20 flex flex-col items-center gap-2">
          <div className="flex h-32 w-10 items-center justify-center">
            <input
              type="range"
              min={MIN_ZOOM * 100}
              max={MAX_ZOOM * 100}
              step={5}
              value={Math.round(viewport.zoom * 100)}
              onChange={(event) => zoomAt(Number(event.target.value) / 100)}
              aria-label="Zoom"
              title="Zoom"
              className="w-28 -rotate-90 accent-purple-600"
            />
          </div>
          <button
            type="button"
            onClick={resetView}
            disabled={isAtFitTarget}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 p-1.5 leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label="Fit map to view"
            title="Fit map to view"
          >
            <Icon name="scope" size={17} />
          </button>
          <button
            type="button"
            onClick={() => changeMode(mode === 'schematic' ? 'geographic' : 'schematic')}
            disabled={!hasSchematicCoordinates}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-xs font-semibold leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label={`Switch to ${mode === 'schematic' ? '3D projection' : '2D schematic'} coordinates`}
            title={`Currently showing ${mode === 'schematic' ? '2D schematic' : '3D projection'} coordinates`}
          >
            {mode === 'schematic' ? '2D' : '3D'}
          </button>
        </div>

        {hovered && hoveredSystem && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-slate-900 shadow dark:border-gray-700 dark:bg-gray-900 dark:text-slate-100"
            style={{
              left: Math.max(8, Math.min(size.width - hoverTooltipWidth - 8, hovered.x + 10)),
              top: Math.max(8, hovered.y - 30),
            }}
          >
            <span>{hoveredName} </span>
            <span style={{ color: hoveredSecurityColor, fontWeight: 700 }}>
              {hoveredSecurity.toFixed(1)}
            </span>
          </div>
        )}

        {!graph && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Loading map data…
          </div>
        )}

        <div data-map-control className="absolute bottom-3 left-3 z-10 rounded-md bg-white/80 px-2 py-1 text-[11px] text-slate-500 backdrop-blur dark:bg-slate-900/80 dark:text-slate-400">
          {selectedSystemIds.size.toLocaleString()} selected · {geometry.points.length.toLocaleString()} systems · {Math.round(viewport.zoom * 100)}%
        </div>
        <div data-map-control className="absolute bottom-3 right-3 z-10 flex items-center gap-3 rounded-md bg-white/80 px-2 py-1 text-[11px] text-slate-500 backdrop-blur dark:bg-slate-900/80 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t border-dotted border-slate-500" />
            Constellation
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t border-dashed border-slate-500" />
            Region
          </span>
        </div>
      </div>
    </section>
  );
}
