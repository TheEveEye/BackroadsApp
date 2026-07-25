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
import { getSovereigntySecurityColor } from '../lib/security';
import {
  ANSIBLEX_MAX_RANGE_LY,
  getAnsiblexDistanceLy,
  getSovereigntyUpgradeIconUrl,
} from '../lib/sovereigntyPlan';
import type {
  PlannedAnsiblexLink,
  PlannedSystemUpgrade,
  SovereigntyPlanSummary,
  SovereigntyUpgradeDefinition,
  SystemResourceSummary,
} from '../lib/sovereigntyPlan';
import { Dropdown, type DropdownOption } from './Dropdown';
import { Icon } from './Icon';

type MapMode = 'schematic' | 'geographic';
type MetricMapDataDisplay =
  | 'power'
  | 'workforce'
  | 'magmaticGas'
  | 'superionicIce'
  | 'upgradeCount';
type MapDataDisplay = 'none' | MetricMapDataDisplay | 'alliance';
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
  power: number;
  workforce: number;
  magmaticGas: number;
  superionicIce: number;
  upgradeCount: number;
  holdingAllianceId?: number;
  eligible: boolean;
};
type MarkerGeometry = {
  kind: 'circle' | 'pill';
  halfWidth: number;
  halfHeight: number;
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
type PlannerPlacementMode = 'neutral' | 'upgrade' | 'ansiblex';
type UpgradeIconGeometry = {
  systemId: number;
  typeId: number;
  left: number;
  top: number;
  size: number;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 16;
const MAP_PADDING = 48;
const PROJECTION_ANIMATION_MS = 560;
const INITIAL_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };
const METRIC_LABEL_FONT = '600 10px system-ui, -apple-system, Segoe UI, sans-serif';
const METRIC_PILL_HEIGHT = 16;
const METRIC_PILL_HORIZONTAL_PADDING = 6;
const UPGRADE_ICON_SIZE = 18;
const UPGRADE_ICON_GAP = 2;
const MAGMATIC_GAS_TYPE_ID = 81143;
const SUPERIONIC_ICE_TYPE_ID = 81144;
const DATA_DISPLAY_OPTIONS = [
  { value: 'none', label: 'No data' },
  { value: 'power', label: 'Power' },
  { value: 'workforce', label: 'Workforce' },
  { value: 'magmaticGas', label: 'Magmatic Gas' },
  { value: 'superionicIce', label: 'Superionic Ice' },
  { value: 'upgradeCount', label: 'Upgrade count' },
  { value: 'alliance', label: 'Alliance logo' },
] satisfies readonly DropdownOption[];

function getIsDarkMode() {
  return typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    : false;
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function getMarkerValue(point: MapPoint, display: MapDataDisplay) {
  if (display === 'power') return point.power;
  if (display === 'workforce') return point.workforce;
  if (display === 'magmaticGas') return point.magmaticGas;
  if (display === 'superionicIce') return point.superionicIce;
  if (display === 'upgradeCount') return point.upgradeCount;
  return null;
}

function isMetricDataDisplay(display: MapDataDisplay): display is MetricMapDataDisplay {
  return (
    display === 'power'
    || display === 'workforce'
    || display === 'magmaticGas'
    || display === 'superionicIce'
    || display === 'upgradeCount'
  );
}

function formatMarkerValue(value: number) {
  return Math.round(value).toString();
}

function getUpgradeIconGeometry(
  systemId: number,
  screen: { x: number; y: number },
  marker: MarkerGeometry,
  upgrades: readonly PlannedSystemUpgrade[],
) {
  const count = upgrades.length;
  if (count === 0) return [];

  const angles = count === 1
    ? [-90]
    : count === 2
      ? [-120, -60]
      : count === 3
        ? [-135, -90, -45]
        : Array.from(
          { length: count },
          (_, index) => -90 + index * (360 / count),
        );
  const minimumRadius = marker.halfHeight + UPGRADE_ICON_SIZE / 2 + 6;
  const minimumCenterSpacing = UPGRADE_ICON_SIZE + UPGRADE_ICON_GAP;
  let spacingRadius = 0;
  const pairCount = count >= 4 ? angles.length : Math.max(0, angles.length - 1);
  for (let index = 0; index < pairCount; index += 1) {
    const previousAngle = angles[index] * Math.PI / 180;
    const currentAngle = angles[(index + 1) % angles.length] * Math.PI / 180;
    const horizontalDelta = Math.abs(Math.cos(currentAngle) - Math.cos(previousAngle));
    const verticalDelta = Math.abs(Math.sin(currentAngle) - Math.sin(previousAngle));
    const strongestAxisDelta = Math.max(horizontalDelta, verticalDelta);
    if (strongestAxisDelta > 0) {
      spacingRadius = Math.max(
        spacingRadius,
        minimumCenterSpacing / strongestAxisDelta,
      );
    }
  }
  const radius = Math.max(minimumRadius, spacingRadius);

  return upgrades.map((upgrade, index): UpgradeIconGeometry => {
    const angle = angles[index] * Math.PI / 180;
    const centerX = screen.x + Math.cos(angle) * radius;
    const centerY = screen.y + Math.sin(angle) * radius;
    return {
      systemId,
      typeId: upgrade.typeId,
      left: centerX - UPGRADE_ICON_SIZE / 2,
      top: centerY - UPGRADE_ICON_SIZE / 2,
      size: UPGRADE_ICON_SIZE,
    };
  });
}

function getHslRelativeLuminance(hue: number, saturation: number, lightness: number) {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (
    1 - Math.abs(2 * normalizedLightness - 1)
  ) * normalizedSaturation;
  const hueSegment = ((hue % 360) + 360) % 360 / 60;
  const secondary = chroma * (1 - Math.abs(hueSegment % 2 - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (hueSegment < 1) {
    red = chroma;
    green = secondary;
  } else if (hueSegment < 2) {
    red = secondary;
    green = chroma;
  } else if (hueSegment < 3) {
    green = chroma;
    blue = secondary;
  } else if (hueSegment < 4) {
    green = secondary;
    blue = chroma;
  } else if (hueSegment < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const match = normalizedLightness - chroma / 2;
  const toLinear = (channel: number) => {
    const value = channel + match;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * toLinear(red)
    + 0.7152 * toLinear(green)
    + 0.0722 * toLinear(blue)
  );
}

function getMetricMarkerColors(
  value: number,
  display: MetricMapDataDisplay,
  maximum: number,
  isDarkMode: boolean,
) {
  const normalized = maximum > 0
    ? Math.sqrt(Math.max(0, Math.min(1, value / maximum)))
    : 0;
  const color = {
    power: { hue: 142, saturation: 78 },
    workforce: { hue: 50, saturation: 88 },
    magmaticGas: { hue: 27, saturation: 92 },
    superionicIce: { hue: 191, saturation: 88 },
    upgradeCount: { hue: 270, saturation: 78 },
  }[display];
  const minimumLightness = isDarkMode ? 24 : 20;
  const maximumLightness = display === 'workforce'
    ? 94
    : isDarkMode
      ? 71
      : 72;
  const lightness = minimumLightness + normalized * (maximumLightness - minimumLightness);
  const relativeLuminance = getHslRelativeLuminance(
    color.hue,
    color.saturation,
    lightness,
  );
  return {
    fill: `hsl(${color.hue} ${color.saturation}% ${lightness}%)`,
    text: relativeLuminance >= 0.19 ? '#0f172a' : '#f8fafc',
  };
}

function getPointMarkerGeometry(
  point: MapPoint,
  display: MapDataDisplay,
  showDataLabels: boolean,
  selected: boolean,
  zoom: number,
  measureLabel: (label: string) => number,
  overrideLabel?: string | null,
) {
  const value = getMarkerValue(point, display);
  if (selected && overrideLabel) {
    const width = Math.max(
      METRIC_PILL_HEIGHT,
      Math.ceil(measureLabel(overrideLabel) + METRIC_PILL_HORIZONTAL_PADDING * 2),
    );
    return {
      kind: 'pill',
      halfWidth: width / 2,
      halfHeight: METRIC_PILL_HEIGHT / 2,
    } satisfies MarkerGeometry;
  }
  if (selected && showDataLabels && display === 'alliance' && point.holdingAllianceId) {
    return { kind: 'circle', halfWidth: 18, halfHeight: 18 } satisfies MarkerGeometry;
  }
  if (selected && showDataLabels && value != null) {
    const label = formatMarkerValue(value);
    const width = Math.max(
      METRIC_PILL_HEIGHT,
      Math.ceil(measureLabel(label) + METRIC_PILL_HORIZONTAL_PADDING * 2),
    );
    return {
      kind: 'pill',
      halfWidth: width / 2,
      halfHeight: METRIC_PILL_HEIGHT / 2,
    } satisfies MarkerGeometry;
  }
  const radius = selected
    ? 2.8
    : zoom >= 4
      ? 2.1
      : point.eligible
        ? 1.55
        : 1.2;
  return { kind: 'circle', halfWidth: radius, halfHeight: radius } satisfies MarkerGeometry;
}

function addMarkerPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  marker: MarkerGeometry,
  expansion = 0,
) {
  const halfWidth = marker.halfWidth + expansion;
  const halfHeight = marker.halfHeight + expansion;
  context.beginPath();
  if (marker.kind === 'circle') {
    context.arc(x, y, halfWidth, 0, Math.PI * 2);
    return;
  }

  const leftCapX = x - halfWidth + halfHeight;
  const rightCapX = x + halfWidth - halfHeight;
  context.moveTo(leftCapX, y - halfHeight);
  context.lineTo(rightCapX, y - halfHeight);
  context.arc(rightCapX, y, halfHeight, -Math.PI / 2, Math.PI / 2);
  context.lineTo(leftCapX, y + halfHeight);
  context.arc(leftCapX, y, halfHeight, Math.PI / 2, Math.PI * 1.5);
  context.closePath();
}

function getMarkerHitDistance(
  pointerX: number,
  pointerY: number,
  markerX: number,
  markerY: number,
  marker: MarkerGeometry,
) {
  const deltaX = pointerX - markerX;
  const deltaY = pointerY - markerY;
  const centerDistance = Math.hypot(deltaX, deltaY);
  if (marker.kind === 'circle') {
    return centerDistance <= Math.max(8, marker.halfWidth + 3)
      ? centerDistance
      : null;
  }

  const hitRadius = marker.halfHeight + 3;
  const axisHalfLength = Math.max(0, marker.halfWidth - marker.halfHeight);
  const closestAxisX = Math.max(-axisHalfLength, Math.min(axisHalfLength, deltaX));
  return Math.hypot(deltaX - closestAxisX, deltaY) <= hitRadius
    ? centerDistance
    : null;
}

function getSegmentHitDistance(
  pointerX: number,
  pointerY: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(pointerX - from.x, pointerY - from.y);
  const progress = Math.max(0, Math.min(
    1,
    ((pointerX - from.x) * deltaX + (pointerY - from.y) * deltaY) / lengthSquared,
  ));
  return Math.hypot(
    pointerX - (from.x + deltaX * progress),
    pointerY - (from.y + deltaY * progress),
  );
}

function getAnsiblexArcControlPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSystemId: number,
  toSystemId: number,
) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return { x: from.x, y: from.y };
  const curveOffset = Math.min(64, Math.max(14, distance * 0.16));
  const direction = deltaX === 0
    ? fromSystemId < toSystemId ? 1 : -1
    : deltaX > 0 ? -1 : 1;
  return {
    x: (from.x + to.x) / 2 - (deltaY / distance) * curveOffset * direction,
    y: (from.y + to.y) / 2 + (deltaX / distance) * curveOffset * direction,
  };
}

function addAnsiblexArcPath(
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSystemId: number,
  toSystemId: number,
) {
  const control = getAnsiblexArcControlPoint(from, to, fromSystemId, toSystemId);
  context.moveTo(from.x, from.y);
  context.quadraticCurveTo(control.x, control.y, to.x, to.y);
}

function getAnsiblexArcHitDistance(
  pointerX: number,
  pointerY: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSystemId: number,
  toSystemId: number,
) {
  const control = getAnsiblexArcControlPoint(from, to, fromSystemId, toSystemId);
  const directDistance = Math.hypot(to.x - from.x, to.y - from.y);
  const segmentCount = Math.min(48, Math.max(12, Math.ceil(directDistance / 12)));
  let minimumDistance = Infinity;
  let previous = from;
  for (let index = 1; index <= segmentCount; index += 1) {
    const progress = index / segmentCount;
    const inverse = 1 - progress;
    const current = {
      x: inverse * inverse * from.x
        + 2 * inverse * progress * control.x
        + progress * progress * to.x,
      y: inverse * inverse * from.y
        + 2 * inverse * progress * control.y
        + progress * progress * to.y,
    };
    minimumDistance = Math.min(
      minimumDistance,
      getSegmentHitDistance(pointerX, pointerY, previous, current),
    );
    previous = current;
  }
  return minimumDistance;
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
  holdingAllianceIdsBySystemId: ReadonlyMap<number, number>;
  onToggleSystem: (systemId: number) => void;
  territoryEditing: boolean;
  onLassoSelection: (systemIds: number[]) => void;
  fitSelectionRequest: number;
  placementMode: PlannerPlacementMode;
  pendingAnsiblexFrom: number | null;
  plannedLinks: readonly PlannedAnsiblexLink[];
  plannedUpgradesBySystem: Readonly<Record<string, readonly PlannedSystemUpgrade[]>>;
  upgradeDefinitionsById: ReadonlyMap<number, SovereigntyUpgradeDefinition>;
  planSummary: SovereigntyPlanSummary;
  selectedLinkId: string | null;
  systemPlanSummaries: Readonly<Record<string, SystemResourceSummary>>;
  placementBlockedReasons: ReadonlyMap<number, string>;
  onPlanSystemClick: (systemId: number) => void;
  onSelectLink: (linkId: string) => void;
};

export function SovereigntyPlannerMap({
  graph,
  selectedSystemIds,
  holdingAllianceIdsBySystemId,
  onToggleSystem,
  territoryEditing,
  onLassoSelection,
  fitSelectionRequest,
  placementMode,
  pendingAnsiblexFrom,
  plannedLinks,
  plannedUpgradesBySystem,
  upgradeDefinitionsById,
  planSummary,
  selectedLinkId,
  systemPlanSummaries,
  placementBlockedReasons,
  onPlanSystemClick,
  onSelectLink,
}: SovereigntyPlannerMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lassoRef = useRef<LassoState | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement | null>(null);
  const resetAnimationFrameRef = useRef<number | null>(null);
  const projectionAnimationFrameRef = useRef<number | null>(null);
  const allianceLogoCacheRef = useRef(new Map<
    number,
    { image: HTMLImageElement; status: 'loading' | 'loaded' | 'error' }
  >());
  const upgradeIconCacheRef = useRef(new Map<
    number,
    { image: HTMLImageElement; status: 'loading' | 'loaded' | 'error' }
  >());
  const metricLabelWidthCacheRef = useRef(new Map<string, number>());
  const lastFitSelectionRequestRef = useRef(0);
  const [mode, setMode] = useState<MapMode>('schematic');
  const [dataDisplay, setDataDisplay] = useState<MapDataDisplay>('none');
  const [allianceLogoRevision, setAllianceLogoRevision] = useState(0);
  const [upgradeIconRevision, setUpgradeIconRevision] = useState(0);
  const [projectionMix, setProjectionMix] = useState(0);
  const [projectionLabelVisibility, setProjectionLabelVisibility] = useState<boolean | null>(null);
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const [isPlanTotalsExpanded, setIsPlanTotalsExpanded] = useState(true);
  const [hovered, setHovered] = useState<{ id: number; x: number; y: number } | null>(null);
  const [hoveredUpgrade, setHoveredUpgrade] = useState<{
    systemId: number;
    typeId: number;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
  const [lassoPoints, setLassoPoints] = useState<Array<{ x: number; y: number }>>([]);

  const schematicCount = useMemo(() => {
    if (!graph) return 0;
    return Object.values(graph.systems).filter((system) => (
      Number.isFinite(system.position2D?.x) && Number.isFinite(system.position2D?.y)
    )).length;
  }, [graph]);
  const hasSchematicCoordinates = schematicCount > 0;
  const holdingAllianceIds = useMemo(
    () => Array.from(new Set(holdingAllianceIdsBySystemId.values())),
    [holdingAllianceIdsBySystemId],
  );

  useEffect(() => {
    if (graph && !hasSchematicCoordinates && mode === 'schematic') {
      setMode('geographic');
      setProjectionMix(1);
    }
  }, [graph, hasSchematicCoordinates, mode]);

  useEffect(() => {
    if (dataDisplay !== 'alliance') return;
    for (const allianceId of holdingAllianceIds) {
      if (allianceLogoCacheRef.current.has(allianceId)) continue;
      const image = new Image();
      image.decoding = 'async';
      const entry: {
        image: HTMLImageElement;
        status: 'loading' | 'loaded' | 'error';
      } = { image, status: 'loading' };
      allianceLogoCacheRef.current.set(allianceId, entry);
      image.onload = () => {
        entry.status = 'loaded';
        setAllianceLogoRevision((revision) => revision + 1);
      };
      image.onerror = () => {
        entry.status = 'error';
        setAllianceLogoRevision((revision) => revision + 1);
      };
      image.src = `https://images.evetech.net/alliances/${allianceId}/logo?size=64`;
    }
  }, [dataDisplay, holdingAllianceIds]);

  useEffect(() => {
    for (const typeId of upgradeDefinitionsById.keys()) {
      if (upgradeIconCacheRef.current.has(typeId)) continue;
      const image = new Image();
      image.decoding = 'async';
      const entry: {
        image: HTMLImageElement;
        status: 'loading' | 'loaded' | 'error';
      } = { image, status: 'loading' };
      upgradeIconCacheRef.current.set(typeId, entry);
      image.onload = () => {
        entry.status = 'loaded';
        setUpgradeIconRevision((revision) => revision + 1);
      };
      image.onerror = () => {
        entry.status = 'error';
        setUpgradeIconRevision((revision) => revision + 1);
      };
      image.src = getSovereigntyUpgradeIconUrl(typeId);
    }
  }, [upgradeDefinitionsById]);

  const geometry = useMemo(() => {
    const points: MapPoint[] = [];
    const pointsById = new Map<number, MapPoint>();
    const edges: MapEdge[] = [];
    if (!graph) {
      return {
        points,
        pointsById,
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
        power: system.power ?? 0,
        workforce: system.workforce ?? 0,
        magmaticGas: system.magmaticGas ?? 0,
        superionicIce: system.superionicIce ?? 0,
        upgradeCount: plannedUpgradesBySystem[String(id)]?.length ?? 0,
        holdingAllianceId: holdingAllianceIdsBySystemId.get(id),
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
    return { points, pointsById, edges, bounds };
  }, [graph, holdingAllianceIdsBySystemId, plannedUpgradesBySystem, projectionMix]);

  const metricMaximums = useMemo(() => {
    let power = 0;
    let workforce = 0;
    let magmaticGas = 0;
    let superionicIce = 0;
    let upgradeCount = 0;
    for (const point of geometry.points) {
      power = Math.max(power, point.power);
      workforce = Math.max(workforce, point.workforce);
      magmaticGas = Math.max(magmaticGas, point.magmaticGas);
      superionicIce = Math.max(superionicIce, point.superionicIce);
      upgradeCount = Math.max(upgradeCount, point.upgradeCount);
    }
    return { power, workforce, magmaticGas, superionicIce, upgradeCount };
  }, [geometry.points]);

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
  const getCachedMetricLabelWidth = useCallback((label: string) => (
    metricLabelWidthCacheRef.current.get(label) ?? label.length * 6.25
  ), []);
  const dataLabelZoomThreshold = mode === 'schematic' ? 10 : 5;
  const showUpgradeIcons = viewport.zoom >= dataLabelZoomThreshold;
  const showDataLabels = (
    dataDisplay !== 'none'
    && (
      projectionLabelVisibility
      ?? viewport.zoom >= dataLabelZoomThreshold
    )
  );
  const ansiblexDistancesBySystemId = useMemo(() => {
    const distances = new Map<number, number>();
    if (
      !graph
      || placementMode !== 'ansiblex'
      || pendingAnsiblexFrom == null
    ) return distances;
    for (const systemId of selectedSystemIds) {
      distances.set(
        systemId,
        getAnsiblexDistanceLy(graph, pendingAnsiblexFrom, systemId),
      );
    }
    return distances;
  }, [graph, pendingAnsiblexFrom, placementMode, selectedSystemIds]);
  const getAnsiblexDistanceLabel = useCallback((systemId: number) => {
    const distance = ansiblexDistancesBySystemId.get(systemId);
    return distance == null || !Number.isFinite(distance)
      ? null
      : `${distance.toFixed(1)} ly`;
  }, [ansiblexDistancesBySystemId]);

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
      context.globalAlpha = prominent ? 0.55 : territoryEditing ? 0.35 : 0.15;
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
    for (const link of plannedLinks) {
      const fromPoint = geometry.pointsById.get(link.from);
      const toPoint = geometry.pointsById.get(link.to);
      if (!fromPoint || !toPoint) continue;
      const from = pointToScreen(fromPoint);
      const to = pointToScreen(toPoint);
      const emphasized = link.id === selectedLinkId || link.id === hoveredLinkId;
      if (emphasized) {
        context.beginPath();
        addAnsiblexArcPath(context, from, to, link.from, link.to);
        context.strokeStyle = isDarkMode ? '#c4b5fd' : '#7c3aed';
        context.globalAlpha = 0.24;
        context.lineWidth = 7;
        context.stroke();
      }
      context.beginPath();
      addAnsiblexArcPath(context, from, to, link.from, link.to);
      context.strokeStyle = isDarkMode ? '#c4b5fd' : '#7c3aed';
      context.globalAlpha = emphasized ? 1 : 0.82;
      context.lineWidth = emphasized ? 2.8 : 2;
      context.stroke();
    }

    if (
      placementMode === 'ansiblex'
      && pendingAnsiblexFrom != null
      && hovered
      && hovered.id !== pendingAnsiblexFrom
      && selectedSystemIds.has(hovered.id)
    ) {
      const fromPoint = geometry.pointsById.get(pendingAnsiblexFrom);
      const toPoint = geometry.pointsById.get(hovered.id);
      if (fromPoint && toPoint) {
        const from = pointToScreen(fromPoint);
        const to = pointToScreen(toPoint);
        const blocked = placementBlockedReasons.has(hovered.id);
        context.beginPath();
        addAnsiblexArcPath(context, from, to, pendingAnsiblexFrom, hovered.id);
        context.setLineDash([6, 4]);
        context.strokeStyle = blocked
          ? isDarkMode ? '#fca5a5' : '#dc2626'
          : isDarkMode ? '#ddd6fe' : '#7c3aed';
        context.globalAlpha = 0.9;
        context.lineWidth = 2;
        context.stroke();
        context.setLineDash([]);
      }
    }

    context.font = METRIC_LABEL_FONT;
    const measureMetricLabel = (label: string) => {
      const cachedWidth = metricLabelWidthCacheRef.current.get(label);
      if (cachedWidth != null) return cachedWidth;
      const width = context.measureText(label).width;
      metricLabelWidthCacheRef.current.set(label, width);
      return width;
    };
    for (const point of geometry.points) {
      const screen = pointToScreen(point);
      const selected = selectedSystemIds.has(point.id);
      const ansiblexDistance = ansiblexDistancesBySystemId.get(point.id);
      const ansiblexDistanceLabel = getAnsiblexDistanceLabel(point.id);
      const showPointData = selected && (
        showDataLabels || ansiblexDistanceLabel != null
      );
      const marker = getPointMarkerGeometry(
        point,
        dataDisplay,
        showDataLabels,
        selected,
        viewport.zoom,
        measureMetricLabel,
        ansiblexDistanceLabel,
      );
      const plannedUpgrades = plannedUpgradesBySystem[String(point.id)] ?? [];
      const upgradeIconGeometry = plannedUpgrades.length > 0 && showUpgradeIcons
        ? getUpgradeIconGeometry(point.id, screen, marker, plannedUpgrades)
        : [];
      let renderMarginX = Math.max(6, marker.halfWidth + 3);
      let renderMarginY = Math.max(6, marker.halfHeight + 3);
      for (const icon of upgradeIconGeometry) {
        renderMarginX = Math.max(
          renderMarginX,
          Math.abs(icon.left - screen.x),
          Math.abs(icon.left + icon.size - screen.x),
        );
        renderMarginY = Math.max(
          renderMarginY,
          Math.abs(icon.top - screen.y),
          Math.abs(icon.top + icon.size - screen.y),
        );
      }
      if (
        screen.x < -renderMarginX
        || screen.x > size.width + renderMarginX
        || screen.y < -renderMarginY
        || screen.y > size.height + renderMarginY
      ) continue;
      const security = Math.max(0, Math.min(1, point.security));
      const hue = 4 + security * 205;
      const outsidePlacementTerritory = placementMode !== 'neutral' && !selected;
      const placementBlocked = placementBlockedReasons.has(point.id);
      context.globalAlpha = selected
        ? ansiblexDistanceLabel != null ? 1 : placementBlocked ? 0.34 : 1
        : territoryEditing
          ? point.eligible
            ? hasSelection ? 0.72 : 0.95
            : hasSelection ? 0.2 : 0.24
          : outsidePlacementTerritory
            ? 0.055
          : point.eligible
            ? hasSelection ? 0.17 : 0.9
            : hasSelection ? 0.045 : 0.12;
      const markerValue = getMarkerValue(point, dataDisplay);
      const metricColors = (
        ansiblexDistanceLabel == null
        &&
        markerValue != null
        && isMetricDataDisplay(dataDisplay)
      )
        ? getMetricMarkerColors(
          markerValue,
          dataDisplay,
          metricMaximums[dataDisplay],
          isDarkMode,
        )
        : null;
      const ansiblexDistanceFill = ansiblexDistanceLabel == null
        ? null
        : point.id === pendingAnsiblexFrom
          ? isDarkMode ? '#8b5cf6' : '#6d28d9'
          : placementBlocked || (ansiblexDistance ?? Infinity) > ANSIBLEX_MAX_RANGE_LY
            ? isDarkMode ? '#ef4444' : '#b91c1c'
            : isDarkMode ? '#a78bfa' : '#7c3aed';
      context.fillStyle = ansiblexDistanceFill
        ?? metricColors?.fill
        ?? `hsl(${hue} 72% ${isDarkMode ? 62 : 42}%)`;
      addMarkerPath(context, screen.x, screen.y, marker);
      context.fill();
      const allianceLogoEntry = point.holdingAllianceId
        ? allianceLogoCacheRef.current.get(point.holdingAllianceId)
        : null;
      if (
        showPointData
        && dataDisplay === 'alliance'
        && allianceLogoEntry?.status === 'loaded'
      ) {
        const allianceLogoRadius = Math.max(1, marker.halfWidth - 1);
        context.save();
        context.beginPath();
        context.arc(screen.x, screen.y, allianceLogoRadius, 0, Math.PI * 2);
        context.clip();
        context.drawImage(
          allianceLogoEntry.image,
          screen.x - marker.halfWidth,
          screen.y - marker.halfHeight,
          marker.halfWidth * 2,
          marker.halfHeight * 2,
        );
        context.restore();
      }
      if (ansiblexDistanceLabel != null) {
        context.fillStyle = '#ffffff';
        context.globalAlpha = 1;
        context.font = METRIC_LABEL_FONT;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(ansiblexDistanceLabel, screen.x, screen.y + 0.5);
      } else if (showPointData && markerValue != null) {
        context.fillStyle = metricColors?.text ?? (isDarkMode ? '#0f172a' : '#ffffff');
        context.globalAlpha = 1;
        context.font = METRIC_LABEL_FONT;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(formatMarkerValue(markerValue), screen.x, screen.y + 0.5);
      }
      if (selected) {
        context.strokeStyle = isDarkMode ? '#f8fafc' : '#0f172a';
        context.globalAlpha = territoryEditing ? 0.92 : 0.7;
        context.lineWidth = territoryEditing ? 1.2 : 0.9;
        addMarkerPath(context, screen.x, screen.y, marker, 1.7);
        context.stroke();
      }
      const summary = systemPlanSummaries[String(point.id)];
      if (summary?.remainingPower < 0 || summary?.remainingWorkforce < 0) {
        context.globalAlpha = 1;
        context.lineWidth = 2;
        context.strokeStyle = summary.remainingPower < 0 ? '#dc2626' : '#d97706';
        addMarkerPath(context, screen.x, screen.y, marker, 4.5);
        context.stroke();
        if (summary.remainingPower < 0 && summary.remainingWorkforce < 0) {
          context.lineWidth = 1.5;
          context.strokeStyle = '#d97706';
          addMarkerPath(context, screen.x, screen.y, marker, 7);
          context.stroke();
        }
      }
      if (upgradeIconGeometry.length > 0) {
        for (const icon of upgradeIconGeometry) {
          const iconEntry = upgradeIconCacheRef.current.get(icon.typeId);
          context.globalAlpha = 1;
          if (iconEntry?.status === 'loaded') {
            context.drawImage(
              iconEntry.image,
              icon.left,
              icon.top,
              icon.size,
              icon.size,
            );
          } else {
            context.save();
            context.beginPath();
            context.roundRect(icon.left, icon.top, icon.size, icon.size, 3);
            context.clip();
            context.fillStyle = '#7c3aed';
            context.fillRect(icon.left, icon.top, icon.size, icon.size);
            context.fillStyle = '#ffffff';
            context.font = '700 10px system-ui, -apple-system, Segoe UI, sans-serif';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText('?', icon.left + icon.size / 2, icon.top + icon.size / 2 + 0.5);
            context.restore();
          }
        }
      }
      if (point.id === pendingAnsiblexFrom) {
        context.globalAlpha = 1;
        context.lineWidth = 2.5;
        context.strokeStyle = isDarkMode ? '#ddd6fe' : '#6d28d9';
        addMarkerPath(context, screen.x, screen.y, marker, 9);
        context.stroke();
      }
    }

    if (hovered) {
      const point = geometry.points.find((candidate) => candidate.id === hovered.id);
      if (point) {
        const screen = pointToScreen(point);
        const marker = getPointMarkerGeometry(
          point,
          dataDisplay,
          showDataLabels,
          selectedSystemIds.has(point.id),
          viewport.zoom,
          measureMetricLabel,
          getAnsiblexDistanceLabel(point.id),
        );
        context.strokeStyle = isDarkMode ? '#f8fafc' : '#0f172a';
        context.globalAlpha = 1;
        context.lineWidth = 1.5;
        addMarkerPath(context, screen.x, screen.y, marker, 2.5);
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
    allianceLogoRevision,
    ansiblexDistancesBySystemId,
    geometry.edges,
    geometry.points,
    geometry.pointsById,
    getAnsiblexDistanceLabel,
    dataDisplay,
    hovered,
    hoveredLinkId,
    isDarkMode,
    lassoPoints,
    metricMaximums,
    pointToScreen,
    placementBlockedReasons,
    placementMode,
    plannedLinks,
    pendingAnsiblexFrom,
    selectedLinkId,
    selectedSystemIds,
    showDataLabels,
    size.height,
    size.width,
    territoryEditing,
    plannedUpgradesBySystem,
    showUpgradeIcons,
    systemPlanSummaries,
    upgradeIconRevision,
    viewport.zoom,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDarkMode(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (placementMode !== 'neutral' || territoryEditing) {
      setHoveredUpgrade(null);
    }
  }, [placementMode, territoryEditing]);

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
    setHoveredUpgrade(null);
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
    setHoveredUpgrade(null);

    const startMix = projectionMix;
    const targetMix = nextMode === 'geographic' ? 1 : 0;
    const startViewport = viewport;
    const targetViewport = getProjectionFitViewport(
      graph,
      targetMix,
      selectedSystemIds,
      size,
    );
    const targetLabelZoomThreshold = nextMode === 'schematic' ? 10 : 5;
    setProjectionLabelVisibility(targetViewport.zoom >= targetLabelZoomThreshold);
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
        setProjectionLabelVisibility(null);
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
    selectedOnly = false,
  ) => {
    let nearest: { id: number; x: number; y: number; distance: number } | null = null;
    for (const point of geometry.points) {
      if (eligibleOnly && !point.eligible) continue;
      if (selectedOnly && !selectedSystemIds.has(point.id)) continue;
      const screen = pointToScreen(point);
      const marker = getPointMarkerGeometry(
        point,
        dataDisplay,
        showDataLabels,
        selectedSystemIds.has(point.id),
        viewport.zoom,
        getCachedMetricLabelWidth,
        getAnsiblexDistanceLabel(point.id),
      );
      const hitDistance = getMarkerHitDistance(
        pointerX,
        pointerY,
        screen.x,
        screen.y,
        marker,
      );
      if (hitDistance != null && (!nearest || hitDistance < nearest.distance)) {
        nearest = { id: point.id, x: screen.x, y: screen.y, distance: hitDistance };
      }
    }
    return nearest;
  }, [
    dataDisplay,
    geometry.points,
    getAnsiblexDistanceLabel,
    getCachedMetricLabelWidth,
    pointToScreen,
    selectedSystemIds,
    showDataLabels,
    viewport.zoom,
  ]);

  const findUpgradeIcon = useCallback((pointerX: number, pointerY: number) => {
    if (!showUpgradeIcons) return null;
    for (const point of geometry.points) {
      const upgrades = plannedUpgradesBySystem[String(point.id)] ?? [];
      if (upgrades.length === 0) continue;
      const screen = pointToScreen(point);
      const marker = getPointMarkerGeometry(
        point,
        dataDisplay,
        showDataLabels,
        selectedSystemIds.has(point.id),
        viewport.zoom,
        getCachedMetricLabelWidth,
        getAnsiblexDistanceLabel(point.id),
      );
      const icons = getUpgradeIconGeometry(point.id, screen, marker, upgrades);
      for (const icon of icons) {
        if (
          pointerX >= icon.left
          && pointerX <= icon.left + icon.size
          && pointerY >= icon.top
          && pointerY <= icon.top + icon.size
        ) {
          return {
            systemId: icon.systemId,
            typeId: icon.typeId,
            x: icon.left + icon.size / 2,
            y: icon.top + icon.size / 2,
          };
        }
      }
    }
    return null;
  }, [
    dataDisplay,
    geometry.points,
    getCachedMetricLabelWidth,
    getAnsiblexDistanceLabel,
    plannedUpgradesBySystem,
    pointToScreen,
    selectedSystemIds,
    showDataLabels,
    showUpgradeIcons,
    viewport.zoom,
  ]);

  const findNearestAnsiblexLink = useCallback((pointerX: number, pointerY: number) => {
    let nearest: { id: string; distance: number } | null = null;
    for (const link of plannedLinks) {
      const fromPoint = geometry.pointsById.get(link.from);
      const toPoint = geometry.pointsById.get(link.to);
      if (!fromPoint || !toPoint) continue;
      const distance = getAnsiblexArcHitDistance(
        pointerX,
        pointerY,
        pointToScreen(fromPoint),
        pointToScreen(toPoint),
        link.from,
        link.to,
      );
      if (distance <= 6 && (!nearest || distance < nearest.distance)) {
        nearest = { id: link.id, distance };
      }
    }
    return nearest;
  }, [geometry.pointsById, plannedLinks, pointToScreen]);

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
      setHoveredUpgrade(null);
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
    setHoveredUpgrade(null);
    setHoveredLinkId(null);
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
    const upgradeIcon = placementMode === 'neutral' && !territoryEditing
      ? findUpgradeIcon(pointerX, pointerY)
      : null;
    if (upgradeIcon) {
      setHoveredUpgrade(upgradeIcon);
      setHovered(null);
      setHoveredLinkId(null);
      return;
    }
    setHoveredUpgrade(null);
    const nearest = (
      placementMode !== 'neutral'
        ? findNearestSystem(pointerX, pointerY, false, true)
        : null
    ) ?? findNearestSystem(pointerX, pointerY, false);
    if (nearest) {
      setHovered({ id: nearest.id, x: nearest.x, y: nearest.y });
      setHoveredLinkId(null);
    } else {
      setHovered(null);
      setHoveredLinkId(
        placementMode === 'neutral'
          ? findNearestAnsiblexLink(pointerX, pointerY)?.id ?? null
          : null,
      );
    }
  }, [
    findNearestAnsiblexLink,
    findNearestSystem,
    findUpgradeIcon,
    placementMode,
    territoryEditing,
  ]);

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
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const upgradeIcon = (
        !territoryEditing && placementMode === 'neutral'
          ? findUpgradeIcon(pointerX, pointerY)
          : null
      );
      const nearest = territoryEditing
        ? findNearestSystem(pointerX, pointerY, true)
        : (
          placementMode !== 'neutral'
            ? findNearestSystem(pointerX, pointerY, false, true)
            : null
        ) ?? findNearestSystem(pointerX, pointerY, false);
      if (upgradeIcon) onPlanSystemClick(upgradeIcon.systemId);
      else if (territoryEditing && nearest) onToggleSystem(nearest.id);
      else if (!territoryEditing && nearest) onPlanSystemClick(nearest.id);
      else if (!territoryEditing && placementMode === 'neutral') {
        const link = findNearestAnsiblexLink(pointerX, pointerY);
        if (link) onSelectLink(link.id);
      }
    }
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [
    findNearestSystem,
    findNearestAnsiblexLink,
    findUpgradeIcon,
    geometry.points,
    onLassoSelection,
    onToggleSystem,
    onPlanSystemClick,
    onSelectLink,
    placementMode,
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
  const hoveredSecurityColor = getSovereigntySecurityColor(hoveredSecurity);
  const hoveredPoint = hovered
    ? geometry.points.find((point) => point.id === hovered.id)
    : null;
  const hoveredMarker = hoveredPoint
    ? getPointMarkerGeometry(
      hoveredPoint,
      dataDisplay,
      showDataLabels,
      selectedSystemIds.has(hoveredPoint.id),
      viewport.zoom,
      getCachedMetricLabelWidth,
      getAnsiblexDistanceLabel(hoveredPoint.id),
    )
    : null;
  const hoveredSystemId = hovered?.id ?? null;
  const hoveredSummary = hoveredSystemId == null
    ? null
    : systemPlanSummaries[String(hoveredSystemId)] ?? null;
  const hoveredPlacementBlock = hoveredSystemId == null
    ? null
    : placementBlockedReasons.get(hoveredSystemId) ?? (
      placementMode !== 'neutral' && !selectedSystemIds.has(hoveredSystemId)
        ? 'This system is outside the selected territory.'
        : null
    );
  const hoveredUpgradeDefinition = hoveredUpgrade
    ? upgradeDefinitionsById.get(hoveredUpgrade.typeId) ?? null
    : null;
  const hoveredUpgradeSystemName = hoveredUpgrade
    ? graph?.namesById?.[String(hoveredUpgrade.systemId)] ?? String(hoveredUpgrade.systemId)
    : null;
  const upgradeTooltipWidth = Math.min(
    300,
    Math.max(224, (hoveredUpgradeDefinition?.name.length ?? 0) * 7 + 58),
  );
  const upgradeTooltipLeft = hoveredUpgrade
    ? Math.max(
      8,
      Math.min(
        Math.max(8, size.width - upgradeTooltipWidth - 8),
        hoveredUpgrade.x + 12,
      ),
    )
    : 8;
  const upgradeTooltipTop = hoveredUpgrade
    ? Math.max(8, Math.min(Math.max(8, size.height - 190), hoveredUpgrade.y + 12))
    : 8;
  const hoverTooltipWidth = Math.min(
    300,
    Math.max(
      hoveredSummary ? 248 : 196,
      (hoveredName?.length ?? 0) * 7 + 44,
    ),
  );
  const hoverTooltipHeight = 112
    + (hoveredSummary ? 52 : 0)
    + (hoveredPlacementBlock ? 42 : 0);
  const hoverTooltipLeft = hovered
    ? Math.max(
      8,
      Math.min(
        Math.max(8, size.width - hoverTooltipWidth - 8),
        hovered.x - hoverTooltipWidth / 2,
      ),
    )
    : 8;
  const hoverTooltipTop = hovered
    ? Math.max(
      8,
      Math.min(
        Math.max(8, size.height - hoverTooltipHeight - 8),
        hovered.y + (hoveredMarker?.halfHeight ?? 0) + 9,
      ),
    )
    : 8;
  useLayoutEffect(() => {
    const tooltip = hoverTooltipRef.current;
    if (
      hoveredSystemId == null
      || !tooltip
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return;

    const animation = tooltip.animate(
      [
        { opacity: 0, transform: 'translateY(-4px) scaleX(0.96) scaleY(0.82)' },
        { opacity: 1, transform: 'translateY(0) scaleX(1) scaleY(1)' },
      ],
      {
        duration: 150,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'both',
      },
    );
    return () => animation.cancel();
  }, [hoveredSystemId]);

  const isAtFitTarget = (
    Math.abs(viewport.zoom - fitTargetViewport.zoom) < 0.001
    && Math.abs(viewport.panX - fitTargetViewport.panX) < 0.1
    && Math.abs(viewport.panY - fitTargetViewport.panY) < 0.1
  );
  const hoveredIsBlocked = hoveredSystemId != null && (
    placementBlockedReasons.has(hoveredSystemId)
    || !selectedSystemIds.has(hoveredSystemId)
  );
  const cursorClass = territoryEditing && (isAltPressed || lassoPoints.length > 0)
    ? 'cursor-crosshair'
    : isPanning
      ? 'cursor-grabbing'
      : territoryEditing && hoveredSystem?.isSovereigntyEligible
        ? 'cursor-pointer'
        : placementMode !== 'neutral' && hoveredSystem
          ? hoveredIsBlocked ? 'cursor-not-allowed' : 'cursor-crosshair'
          : placementMode === 'neutral' && (hoveredUpgrade || hoveredSystem || hoveredLinkId)
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
          if (!dragRef.current && !lassoRef.current) {
            setHovered(null);
            setHoveredUpgrade(null);
            setHoveredLinkId(null);
          }
        }}
        role="application"
        aria-label={lassoPoints.length > 0
          ? 'Sovereignty map. Draw around systems to change the territory selection. Press Escape to cancel.'
          : territoryEditing
            ? 'Sovereignty map. Click systems to change the territory selection, hold Alt or Option and drag to lasso, drag normally to pan, and use the mouse wheel or map controls to zoom.'
            : placementMode === 'ansiblex'
              ? pendingAnsiblexFrom == null
                ? 'Sovereignty map. Click a system to choose the first Ansiblex endpoint.'
                : 'Sovereignty map. Click a system to choose the second Ansiblex endpoint. Press Escape to cancel the first endpoint.'
              : placementMode === 'upgrade'
                ? 'Sovereignty map. Click systems to place the selected sovereignty upgrade.'
                : 'Sovereignty map. Click systems or Ansiblex links to inspect them, drag to pan, and use the mouse wheel or map controls to zoom.'}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        <div
          data-map-control
          className="absolute left-3 top-3 z-20"
        >
          <Dropdown
            value={dataDisplay}
            options={DATA_DISPLAY_OPTIONS}
            onChange={(nextValue) => setDataDisplay(nextValue as MapDataDisplay)}
            ariaLabel="System dot data"
            label="Dots"
            buttonClassName="!bg-white/90 px-2.5 py-1.5 shadow-sm backdrop-blur dark:!bg-gray-900/90"
          />
        </div>

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
            ref={hoverTooltipRef}
            className="pointer-events-none absolute z-30 min-w-44 whitespace-nowrap rounded-md border border-gray-300 bg-white px-2.5 py-2 text-xs text-slate-900 shadow dark:border-gray-700 dark:bg-gray-900 dark:text-slate-100"
            style={{
              left: hoverTooltipLeft,
              top: hoverTooltipTop,
              width: hoverTooltipWidth,
              transformOrigin: 'top center',
              willChange: 'transform, opacity',
            }}
          >
            <div>
              <span className="font-medium">{hoveredName} </span>
              <span style={{ color: hoveredSecurityColor, fontWeight: 700 }}>
                {hoveredSecurity.toFixed(1)}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-0.5 border-t border-slate-200 pt-1.5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <span>Workforce</span>
              <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                {hoveredSummary
                  ? `${formatMarkerValue(hoveredSummary.allocatedWorkforce)} / ${formatMarkerValue(hoveredSummary.totalWorkforce)}`
                  : (hoveredSystem.workforce ?? 0).toLocaleString()}
              </span>
              <span>Power</span>
              <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                {hoveredSummary
                  ? `${formatMarkerValue(hoveredSummary.allocatedPower)} / ${formatMarkerValue(hoveredSummary.totalPower)}`
                  : (hoveredSystem.power ?? 0).toLocaleString()}
              </span>
              <span>Magmatic Gas</span>
              <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                {(hoveredSystem.magmaticGas ?? 0).toLocaleString()}
              </span>
              <span>Superionic Ice</span>
              <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                {(hoveredSystem.superionicIce ?? 0).toLocaleString()}
              </span>
              {hoveredSummary && (
                <>
                  <span>Upgrades</span>
                  <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                    {hoveredSummary.upgradeCount}
                  </span>
                  <span>Workforce remaining</span>
                  <span className={`text-right font-medium tabular-nums ${
                    hoveredSummary.remainingWorkforce < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-800 dark:text-slate-200'
                  }`}>
                    {formatMarkerValue(hoveredSummary.remainingWorkforce)}
                  </span>
                  <span>Power remaining</span>
                  <span className={`text-right font-medium tabular-nums ${
                    hoveredSummary.remainingPower < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-800 dark:text-slate-200'
                  }`}>
                    {formatMarkerValue(hoveredSummary.remainingPower)}
                  </span>
                </>
              )}
            </div>
            {hoveredPlacementBlock && (
              <div className="mt-1.5 whitespace-normal border-t border-amber-200 pt-1.5 text-[11px] leading-4 text-amber-700 dark:border-amber-800 dark:text-amber-300">
                {hoveredPlacementBlock}
              </div>
            )}
          </div>
        )}

        {hoveredUpgrade && hoveredUpgradeDefinition && (
          <div
            className="pointer-events-none absolute z-30 rounded-md border border-gray-300 bg-white px-2.5 py-2 text-xs text-slate-900 shadow dark:border-gray-700 dark:bg-gray-900 dark:text-slate-100"
            style={{
              left: upgradeTooltipLeft,
              top: upgradeTooltipTop,
              width: upgradeTooltipWidth,
            }}
          >
            <div className="flex items-center gap-2">
              <img
                src={getSovereigntyUpgradeIconUrl(hoveredUpgradeDefinition.typeId)}
                alt=""
                aria-hidden="true"
                className="h-8 w-8 shrink-0 rounded object-contain"
              />
              <div className="min-w-0">
                <div className="font-semibold">{hoveredUpgradeDefinition.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {hoveredUpgradeSystemName}
                </div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-t border-slate-200 pt-1.5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {hoveredUpgradeDefinition.powerAllocation !== 0 && (
                <>
                  <span>Power allocation</span>
                  <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                    {formatMarkerValue(hoveredUpgradeDefinition.powerAllocation)}
                  </span>
                </>
              )}
              {hoveredUpgradeDefinition.powerProduction !== 0 && (
                <>
                  <span>Power production</span>
                  <span className="text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                    +{formatMarkerValue(hoveredUpgradeDefinition.powerProduction)}
                  </span>
                </>
              )}
              {hoveredUpgradeDefinition.workforceAllocation !== 0 && (
                <>
                  <span>Workforce allocation</span>
                  <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                    {formatMarkerValue(hoveredUpgradeDefinition.workforceAllocation)}
                  </span>
                </>
              )}
              {hoveredUpgradeDefinition.workforceProduction !== 0 && (
                <>
                  <span>Workforce production</span>
                  <span className="text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                    +{formatMarkerValue(hoveredUpgradeDefinition.workforceProduction)}
                  </span>
                </>
              )}
              {hoveredUpgradeDefinition.fuel && (
                <>
                  <span>
                    {hoveredUpgradeDefinition.fuel.typeId === MAGMATIC_GAS_TYPE_ID
                      ? 'Magma startup'
                      : hoveredUpgradeDefinition.fuel.typeId === SUPERIONIC_ICE_TYPE_ID
                        ? 'Ice startup'
                        : 'Fuel startup'}
                  </span>
                  <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                    {formatMarkerValue(hoveredUpgradeDefinition.fuel.startupCost)}
                  </span>
                  <span>
                    {hoveredUpgradeDefinition.fuel.typeId === MAGMATIC_GAS_TYPE_ID
                      ? 'Magma / hour'
                      : hoveredUpgradeDefinition.fuel.typeId === SUPERIONIC_ICE_TYPE_ID
                        ? 'Ice / hour'
                        : 'Fuel / hour'}
                  </span>
                  <span className="text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                    {formatMarkerValue(hoveredUpgradeDefinition.fuel.hourlyUpkeep)}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {!graph && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Loading map data…
          </div>
        )}

        <div
          data-map-control
          className={`absolute bottom-3 left-3 z-10 rounded-md border border-slate-200 bg-white/90 p-2.5 text-[11px] shadow-sm backdrop-blur transition-[min-width] duration-200 ease-out dark:border-slate-700 dark:bg-slate-900/90 ${
            isPlanTotalsExpanded ? 'min-w-48' : 'min-w-36'
          }`}
        >
          <button
            type="button"
            onClick={() => setIsPlanTotalsExpanded((expanded) => !expanded)}
            className="flex w-full items-center justify-between gap-3 text-xs font-semibold text-slate-800 hover:text-purple-700 dark:text-slate-100 dark:hover:text-purple-300"
            aria-expanded={isPlanTotalsExpanded}
            aria-controls="sovereignty-plan-totals-content"
          >
            <span>Plan totals</span>
            <Icon
              name="chevron-down"
              size={11}
              className={`transition-transform duration-200 ${isPlanTotalsExpanded ? '' : '-rotate-90'}`}
            />
          </button>
          <div
            id="sovereignty-plan-totals-content"
            aria-hidden={!isPlanTotalsExpanded}
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
              isPlanTotalsExpanded
                ? 'grid-rows-[1fr] opacity-100'
                : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="pt-1.5">
              <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-slate-600 dark:text-slate-300">
                <span>Upgrades</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {planSummary.upgradeCount.toLocaleString()}
                </span>
                <span>Ansiblex links</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {planSummary.ansiblexCount.toLocaleString()}
                </span>
                <span>Workforce imports</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {Math.round(planSummary.workforceImportRequired).toLocaleString()}
                </span>
                <span>Workforce surplus</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {Math.round(planSummary.workforceSurplus).toLocaleString()}
                </span>
                <span>Magma startup</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {Math.round(planSummary.magmaticGasStartup).toLocaleString()}
                </span>
                <span>Magma / hour</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {Math.round(planSummary.magmaticGasHourly).toLocaleString()}
                </span>
                <span>Ice startup</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {Math.round(planSummary.superionicIceStartup).toLocaleString()}
                </span>
                <span>Ice / hour</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">
                  {Math.round(planSummary.superionicIceHourly).toLocaleString()}
                </span>
              </div>
              {(planSummary.powerDeficitSystems > 0 || planSummary.workforceDeficitSystems > 0) && (
                <div className="mt-1.5 border-t border-amber-300/70 pt-1.5 text-amber-700 dark:border-amber-700/70 dark:text-amber-300">
                  {planSummary.powerDeficitSystems > 0 && (
                    <div>
                      {planSummary.powerDeficitSystems.toLocaleString()} power{' '}
                      {planSummary.powerDeficitSystems === 1 ? 'warning' : 'warnings'}
                    </div>
                  )}
                  {planSummary.workforceDeficitSystems > 0 && (
                    <div>
                      {planSummary.workforceDeficitSystems.toLocaleString()} workforce{' '}
                      {planSummary.workforceDeficitSystems === 1 ? 'warning' : 'warnings'}
                    </div>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>
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
