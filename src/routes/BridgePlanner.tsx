import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { Icon } from '../components/Icon';
import { AnsiblexModal as SharedAnsiblexModal } from '../components/AnsiblexModal';
import { BlacklistModal } from '../components/BlacklistModal';
import { CynoBeaconModal } from '../components/CynoBeaconModal';
import { BridgePlannerMap } from '../components/BridgePlannerMap';
import { SegmentedSlider } from '../components/SegmentedSlider';
import { ModalShell } from '../components/ModalShell';
import { getCopyButtonClass, getCopyButtonIconColor, getCopyButtonIconName, getCopyButtonLabel, useCopyStatuses } from '../lib/copy';
import { calculateJumpTimerStops, getRouteTravelMinutes, clampFatigueReduction, type JumpTimerStop, type TimerMode } from '../lib/jumpTimers';

//const LY = 9.4607e15;

type PlannerState = {
  routeStops: string[];
  bridgeRange: number;
  routesToShow: number;
  presetShipClass: string;
  presetJdc: number;
  presetJfc: number;
  presetJf: number;
  presetFatigueReduction: number;
  startingFatigueMinutes: number;
  startingActivationMinutes: number;
  timerMode: TimerMode;
};

type TravelMode = 'bridge-gate' | 'bridge-only';
type RouteStopDragState = {
  activeIndex: number;
  targetIndex: number;
  startY: number;
  currentY: number;
  rowTops: number[];
  rowHeights: number[];
};

type RouteBridgeLeg = {
  parkingId: number;
  endpointId: number;
  approachPath: number[];
  approachJumps: number;
  bridgeLy: number;
};

type RouteOption = {
  key: string;
  bridgeLegs: RouteBridgeLeg[];
  postBridgePaths: number[][];
  postBridgeJumps: number;
  totalJumps: number;
  totalBridges: number;
  waypointIds?: number[];
};

type RouteDisplayContext = {
  stagingId: number;
  destinationId: number;
  waypointIds: number[];
};

type RouteWorkerMessage = {
  type: 'partial' | 'result';
  requestId: number;
  routes: RouteOption[];
  message: string | null;
  baselineJumps: number | null;
  segmentIndex?: number;
};

type RouteRequestState = {
  requestId: number;
  mode: 'pair' | 'waypoint';
  limit: number;
  totalJobs: number;
  completedJobs: number;
  routeBatches: RouteOption[][];
  messages: Array<string | null>;
  baselineJumps: number | null;
  segmentRoutes?: RouteOption[][];
  segmentBaselines?: Array<number | null>;
  waypointIds?: number[];
  displayContext: RouteDisplayContext;
  bridgeOnlyChain?: boolean;
  totalBridgeBudget?: number;
};

const RANGE_PRESETS = [
  { label: 'Black Ops', base: 4.0, fuelPerLy: 700, fatigueReduction: 75 }, // 8.0 at JDC 5
  { label: 'Carrier Jump', base: 3.5, fuelPerLy: 3000, fatigueReduction: 0 }, // 7.0 at JDC 5
  { label: 'Carrier Conduit', base: 3.5, fuelPerLy: 3000, fatigueReduction: 0 }, // 7.0 at JDC 5
  { label: 'Dreadnought', base: 3.5, fuelPerLy: 3000, fatigueReduction: 0 }, // 7.0 at JDC 5
  { label: 'Force Auxiliary', base: 3.5, fuelPerLy: 3000, fatigueReduction: 0 }, // 7.0 at JDC 5
  { label: 'Jump Freighter', base: 5.0, fuelPerLy: 10000, fatigueReduction: 90 }, // 10.0 at JDC 5
  { label: 'Lancer Dreadnought', base: 4.0, fuelPerLy: 20000, fatigueReduction: 0 }, // 8.0 at JDC 5
  { label: 'Rorqual', base: 5.0, fuelPerLy: 4000, fatigueReduction: 90 }, // 10.0 at JDC 5
  { label: 'Supercarrier Jump', base: 3.0, fuelPerLy: 3000, fatigueReduction: 0 }, // 6.0 at JDC 5
  { label: 'Titan Bridge', base: 3.0, fuelPerLy: 3000, fatigueReduction: 0 }, // 6.0 at JDC 5
  { label: 'Titan Jump', base: 3.0, fuelPerLy: 3000, fatigueReduction: 0 }, // 6.0 at JDC 5
] as const;

const isotopeFormatter = new Intl.NumberFormat('en-US');
const FATIGUE_REDUCTION_OPTIONS = [0, 75, 90] as const;

function getPresetFuelPerLy(shipClass: string) {
  return RANGE_PRESETS.find((preset) => preset.label === shipClass)?.fuelPerLy ?? null;
}

function getPresetFatigueReduction(shipClass: string) {
  return RANGE_PRESETS.find((preset) => preset.label === shipClass)?.fatigueReduction ?? 0;
}

function calculateRouteIsotopes(route: RouteOption, fuelPerLy: number | null, jfcLevel: number, shipClass: string, jfLevel: number) {
  if (fuelPerLy == null) return null;
  const skillModifier = 1 - 0.1 * Math.max(0, Math.min(5, jfcLevel));
  const jumpFreighterModifier = shipClass === 'Jump Freighter'
    ? 1 - 0.1 * Math.max(0, Math.min(5, jfLevel))
    : 1;
  return route.bridgeLegs.reduce((sum, leg) => sum + Math.ceil(leg.bridgeLy * fuelPerLy * skillModifier * jumpFreighterModifier), 0);
}

function formatIsotopes(value: number) {
  return isotopeFormatter.format(value);
}

function formatTimerMinutes(minutes: number) {
  const safeMinutes = Math.max(0, minutes);
  if (safeMinutes > 0 && safeMinutes < 1) return '<1m';
  const rounded = Math.round(safeMinutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function formatRelativeTimer(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  const paddedMinutes = String(mins).padStart(2, '0');
  return `T+${hours}:${paddedMinutes}`;
}

function getRouteBridgeLy(route: RouteOption) {
  return route.bridgeLegs.reduce((sum, leg) => sum + leg.bridgeLy, 0);
}

function pushUnique(ids: number[], id: number) {
  if (ids[ids.length - 1] !== id) ids.push(id);
}

function getBridgeSequence(route: RouteOption) {
  const ids: number[] = [];
  for (const leg of route.bridgeLegs) {
    pushUnique(ids, leg.parkingId);
    pushUnique(ids, leg.endpointId);
  }
  return ids;
}

function getAllRouteIds(route: RouteOption) {
  const ids: number[] = [];
  for (const leg of route.bridgeLegs) {
    for (const id of leg.approachPath) pushUnique(ids, id);
    pushUnique(ids, leg.parkingId);
    pushUnique(ids, leg.endpointId);
  }
  for (const path of route.postBridgePaths) {
    for (const id of path) pushUnique(ids, id);
  }
  return ids;
}

function normalizeRouteStops(stops: string[] | undefined | null) {
  const list = Array.isArray(stops)
    ? stops.filter((stop): stop is string => typeof stop === 'string').map((stop) => stop)
    : [];
  if (list.length >= 2) return list;
  if (list.length === 1) return [list[0], ''];
  return ['', ''];
}

function compareRouteOptions(a: RouteOption, b: RouteOption) {
  if (a.totalJumps !== b.totalJumps) return a.totalJumps - b.totalJumps;
  if (a.totalBridges !== b.totalBridges) return a.totalBridges - b.totalBridges;
  if (a.postBridgeJumps !== b.postBridgeJumps) return a.postBridgeJumps - b.postBridgeJumps;
  const aBridgeLy = getRouteBridgeLy(a);
  const bBridgeLy = getRouteBridgeLy(b);
  if (aBridgeLy !== bBridgeLy) return aBridgeLy - bBridgeLy;
  return a.key.localeCompare(b.key);
}

function mergeTopRoutes(routeBatches: RouteOption[][], limit: number) {
  const byKey = new Map<string, RouteOption>();
  for (const routes of routeBatches) {
    for (const route of routes) {
      const existing = byKey.get(route.key);
      if (!existing || compareRouteOptions(route, existing) < 0) {
        byKey.set(route.key, route);
      }
    }
  }
  return Array.from(byKey.values()).sort(compareRouteOptions).slice(0, limit);
}

function buildTrivialRoute(id: number, key: string): RouteOption {
  return {
    key,
    bridgeLegs: [],
    postBridgePaths: [[id]],
    postBridgeJumps: 0,
    totalJumps: 0,
    totalBridges: 0,
  };
}

function mergeWaypointRoute(prefix: RouteOption, route: RouteOption, waypointIds: number[]) {
  const key = prefix.key === 'root' ? route.key : `${prefix.key}__${route.key}`;
  return {
    key,
    bridgeLegs: [...prefix.bridgeLegs, ...route.bridgeLegs],
    postBridgePaths: [...prefix.postBridgePaths, ...route.postBridgePaths].filter((path) => path.length > 0 && path[0] !== -1),
    postBridgeJumps: prefix.postBridgeJumps + route.postBridgeJumps,
    totalJumps: prefix.totalJumps + route.totalJumps,
    totalBridges: prefix.totalBridges + route.totalBridges,
    waypointIds,
  };
}

function reduceWaypointRoutes(routes: RouteOption[], limit: number) {
  return mergeTopRoutes([routes], limit);
}

function combineWaypointRoutes(segmentRoutes: RouteOption[][], waypointIds: number[], limit: number) {
  let combined: RouteOption[] = [buildTrivialRoute(-1, 'root')];

  for (const routes of segmentRoutes) {
    const next: RouteOption[] = [];
    const seen = new Set<string>();
    for (const prefix of combined) {
      for (const route of routes) {
        const merged = mergeWaypointRoute(prefix, route, waypointIds);
        if (seen.has(merged.key)) continue;
        seen.add(merged.key);
        next.push(merged);
      }
    }
    combined = next.sort(compareRouteOptions).slice(0, limit);
    if (combined.length === 0) break;
  }

  return combined;
}

function combineWaypointRoutesWithBridgeBudget(segmentRoutes: RouteOption[][], waypointIds: number[], limit: number, totalBridgeBudget: number) {
  let combinedByBridges = new Map<number, RouteOption[]>([[0, [buildTrivialRoute(-1, 'root')]]]);

  for (const routes of segmentRoutes) {
    const nextByBridges = new Map<number, RouteOption[]>();
    for (const [usedBridges, prefixes] of combinedByBridges.entries()) {
      for (const prefix of prefixes) {
        for (const route of routes) {
          const nextUsedBridges = usedBridges + route.totalBridges;
          if (nextUsedBridges > totalBridgeBudget) continue;
          const bucket = nextByBridges.get(nextUsedBridges) || [];
          bucket.push(mergeWaypointRoute(prefix, route, waypointIds));
          nextByBridges.set(nextUsedBridges, bucket);
        }
      }
    }
    combinedByBridges = new Map(
      Array.from(nextByBridges.entries()).map(([usedBridges, routes]) => [
        usedBridges,
        reduceWaypointRoutes(routes, limit),
      ])
    );
    if (combinedByBridges.size === 0) break;
  }

  return combinedByBridges.get(totalBridgeBudget) || [];
}

function getWaypointSegmentLabel(segmentIndex: number, totalSegments: number) {
  if (totalSegments <= 1) return 'route';
  if (segmentIndex === 0) return 'the first leg';
  if (segmentIndex === totalSegments - 1) return 'the final leg';
  return `waypoint leg ${segmentIndex}`;
}

function getRouteWorkerCount() {
  return Math.min(4, Math.max(2, Math.floor((window.navigator.hardwareConcurrency || 4) / 2)));
}

export function BridgePlanner() {
  const UI_KEY = 'br.bridgePlanner.ui.v1';
  const SETTINGS_STORAGE_KEY = 'br.settings.v1';
  const ANSIBLEX_STORAGE_KEY = 'br.ansiblex.v1';
  const CYNO_BEACONS_STORAGE_KEY = 'br.cynoBeacons.v1';

  const [graph, setGraph] = useState<GraphData | null>(() => (window as any).appGraph || null);
  const [showAnsiblexModal, setShowAnsiblexModal] = useState(false);
  const [showCynoBeaconModal, setShowCynoBeaconModal] = useState(false);
  const [showBlacklistModal, setShowBlacklistModal] = useState(false);
  const [showWaypointsModal, setShowWaypointsModal] = useState(false);
  const [settings, setSettings] = useState<{
    excludeZarzakh: boolean;
    sameRegionOnly: boolean;
    titanBridgeFirstJump: boolean;
    bridgeIntoDestination: boolean;
    bridgeFromStaging: boolean;
    bridgeCount: number;
    bridgeContinuous: boolean;
    bridgeOnlyChain: boolean;
    allowAnsiblex?: boolean;
    ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }>;
    limitToCynoBeacons?: boolean;
    cynoBeacons?: Array<{ id: number; enabled?: boolean }>;
    blacklistEnabled?: boolean;
    blacklist?: Array<{ id: number; enabled?: boolean }>;
  }>(() => {
    const defaults = {
      excludeZarzakh: true,
      sameRegionOnly: false,
      titanBridgeFirstJump: false,
      bridgeIntoDestination: false,
      bridgeFromStaging: false,
      bridgeCount: 1,
      bridgeContinuous: false,
      bridgeOnlyChain: false,
      allowAnsiblex: false,
      ansiblexes: [] as Array<{ from: number; to: number; enabled?: boolean }>,
      limitToCynoBeacons: false,
      cynoBeacons: [] as Array<{ id: number; enabled?: boolean }>,
      blacklistEnabled: false,
      blacklist: [] as Array<{ id: number; enabled?: boolean }>,
    };
    try {
      const fallbackAnsiblexes = (() => {
        const rawAX = localStorage.getItem(ANSIBLEX_STORAGE_KEY);
        if (!rawAX) return defaults.ansiblexes;
        const arr = JSON.parse(rawAX);
        return Array.isArray(arr) ? arr : defaults.ansiblexes;
      })();
      const fallbackBeacons = (() => {
        const rawBeacons = localStorage.getItem(CYNO_BEACONS_STORAGE_KEY);
        if (!rawBeacons) return defaults.cynoBeacons;
        const arr = JSON.parse(rawBeacons);
        return Array.isArray(arr) ? arr : defaults.cynoBeacons;
      })();

      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            ...defaults,
            excludeZarzakh: typeof parsed.excludeZarzakh === 'boolean' ? parsed.excludeZarzakh : defaults.excludeZarzakh,
            sameRegionOnly: typeof parsed.sameRegionOnly === 'boolean' ? parsed.sameRegionOnly : defaults.sameRegionOnly,
            titanBridgeFirstJump: typeof parsed.titanBridgeFirstJump === 'boolean' ? parsed.titanBridgeFirstJump : defaults.titanBridgeFirstJump,
            bridgeIntoDestination: typeof parsed.bridgeIntoDestination === 'boolean' ? parsed.bridgeIntoDestination : defaults.bridgeIntoDestination,
            bridgeFromStaging: typeof parsed.bridgeFromStaging === 'boolean' ? parsed.bridgeFromStaging : defaults.bridgeFromStaging,
            bridgeCount: Number.isFinite(parsed.bridgeCount) ? Math.max(1, Math.min(2, Number(parsed.bridgeCount))) : defaults.bridgeCount,
            bridgeContinuous: typeof parsed.bridgeContinuous === 'boolean' ? parsed.bridgeContinuous : defaults.bridgeContinuous,
            bridgeOnlyChain: typeof parsed.bridgeOnlyChain === 'boolean' ? parsed.bridgeOnlyChain : defaults.bridgeOnlyChain,
            allowAnsiblex: typeof parsed.allowAnsiblex === 'boolean'
              ? parsed.allowAnsiblex
              : (fallbackAnsiblexes.length > 0 ? true : defaults.allowAnsiblex),
            ansiblexes: Array.isArray(parsed.ansiblexes) ? parsed.ansiblexes : fallbackAnsiblexes,
            limitToCynoBeacons: typeof parsed.limitToCynoBeacons === 'boolean' ? parsed.limitToCynoBeacons : defaults.limitToCynoBeacons,
            cynoBeacons: Array.isArray(parsed.cynoBeacons) ? parsed.cynoBeacons : fallbackBeacons,
            blacklistEnabled: typeof parsed.blacklistEnabled === 'boolean' ? parsed.blacklistEnabled : defaults.blacklistEnabled,
            blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : defaults.blacklist,
          };
        }
      }

      return {
        ...defaults,
        allowAnsiblex: fallbackAnsiblexes.length > 0 ? true : defaults.allowAnsiblex,
        ansiblexes: fallbackAnsiblexes,
        cynoBeacons: fallbackBeacons,
      };
    } catch {}
    return defaults;
  });
  const [planner, setPlanner] = useState<PlannerState>(() => {
    const defaults: PlannerState = {
      routeStops: ['', ''],
      bridgeRange: 6,
      routesToShow: 5,
      presetShipClass: 'Titan Bridge',
      presetJdc: 5,
      presetJfc: 5,
      presetJf: 5,
      presetFatigueReduction: getPresetFatigueReduction('Titan Bridge'),
      startingFatigueMinutes: 0,
      startingActivationMinutes: 0,
      timerMode: 'jump-asap',
    };
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const parsedStops = normalizeRouteStops(
            Array.isArray(parsed.routeStops)
              ? parsed.routeStops
              : [typeof parsed.stagingQuery === 'string' ? parsed.stagingQuery : '', typeof parsed.targetQuery === 'string' ? parsed.targetQuery : '']
          );
          return {
            ...defaults,
            routeStops: parsedStops,
            bridgeRange: Number.isFinite(parsed.bridgeRange) ? Number(parsed.bridgeRange) : defaults.bridgeRange,
            routesToShow: Number.isFinite(parsed.routesToShow) ? Math.max(1, Math.min(25, Number(parsed.routesToShow))) : defaults.routesToShow,
            presetShipClass: typeof parsed.presetShipClass === 'string' ? parsed.presetShipClass : defaults.presetShipClass,
            presetJdc: Number.isFinite(parsed.presetJdc) ? Math.max(0, Math.min(5, Number(parsed.presetJdc))) : defaults.presetJdc,
            presetJfc: Number.isFinite(parsed.presetJfc) ? Math.max(0, Math.min(5, Number(parsed.presetJfc))) : defaults.presetJfc,
            presetJf: Number.isFinite(parsed.presetJf) ? Math.max(0, Math.min(5, Number(parsed.presetJf))) : defaults.presetJf,
            presetFatigueReduction: Number.isFinite(parsed.presetFatigueReduction)
              ? clampFatigueReduction(Number(parsed.presetFatigueReduction))
              : defaults.presetFatigueReduction,
            startingFatigueMinutes: Number.isFinite(parsed.startingFatigueMinutes)
              ? Math.max(0, Math.min(300, Number(parsed.startingFatigueMinutes)))
              : defaults.startingFatigueMinutes,
            startingActivationMinutes: Number.isFinite(parsed.startingActivationMinutes)
              ? Math.max(0, Math.min(30, Number(parsed.startingActivationMinutes)))
              : defaults.startingActivationMinutes,
            timerMode: parsed.timerMode === 'jump-asap' || parsed.timerMode === 'fastest-arrival'
              ? parsed.timerMode
              : defaults.timerMode,
          };
        }
      }
    } catch {}
    return defaults;
  });
  const initialRouteStops = normalizeRouteStops(planner.routeStops);
  const routeStopKeyRef = useRef(initialRouteStops.length);
  const [routeStopKeys, setRouteStopKeys] = useState<string[]>(() =>
    initialRouteStops.map((_, index) => `route-stop-${index}`)
  );
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  const rangePopoverRef = useRef<HTMLDivElement | null>(null);
  const jdcSliderRef = useRef<HTMLDivElement | null>(null);
  const [jdcSliderWidth, setJdcSliderWidth] = useState<number | null>(null);

  useEffect(() => {
    if (graph) return;
    const syncGraph = () => {
      const g = (window as any).appGraph || null;
      if (g) setGraph(g);
    };
    syncGraph();
    const onLoaded = () => syncGraph();
    window.addEventListener('graph-loaded', onLoaded as any);
    return () => window.removeEventListener('graph-loaded', onLoaded as any);
  }, [graph]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);
  useEffect(() => {
    try {
      localStorage.setItem(ANSIBLEX_STORAGE_KEY, JSON.stringify(settings.ansiblexes || []));
    } catch {}
  }, [settings.ansiblexes]);
  useEffect(() => {
    try {
      localStorage.setItem(CYNO_BEACONS_STORAGE_KEY, JSON.stringify(settings.cynoBeacons || []));
    } catch {}
  }, [settings.cynoBeacons]);
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(planner));
    } catch {}
  }, [planner]);

  useEffect(() => {
    if (!rangePopoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rangePopoverRef.current && target && !rangePopoverRef.current.contains(target)) {
        setRangePopoverOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [rangePopoverOpen]);

  useEffect(() => {
    if (!rangePopoverOpen) return;
    const node = jdcSliderRef.current;
    if (!node) return;
    let raf = 0;
    const update = () => {
      const target = jdcSliderRef.current;
      if (!target) return;
      const width = Math.round(target.getBoundingClientRect().width);
      if (width > 0) setJdcSliderWidth(width);
    };
    raf = window.requestAnimationFrame(update);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(node);
    }
    window.addEventListener('resize', update);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [rangePopoverOpen]);

  const routeStops = useMemo(() => normalizeRouteStops(planner.routeStops), [planner.routeStops]);
  const travelMode: TravelMode = settings.bridgeOnlyChain ? 'bridge-only' : 'bridge-gate';
  const isBridgeOnlyMode = travelMode === 'bridge-only';
  const [dragState, setDragState] = useState<RouteStopDragState | null>(null);
  const [isRouteStopDropping, setIsRouteStopDropping] = useState(false);
  const dragStateRef = useRef<RouteStopDragState | null>(null);
  const routeStopDropRafRef = useRef<number | null>(null);
  const routeStopRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const stagingQuery = routeStops[0] ?? '';
  const targetQuery = routeStops[routeStops.length - 1] ?? '';
  const waypointQueries = routeStops.slice(1, -1);
  const presetControlWidth = jdcSliderWidth ?? 186;
  const makeRouteStopKey = () => `route-stop-${routeStopKeyRef.current++}`;
  const setRouteStops = (updater: string[] | ((prev: string[]) => string[])) => {
    setPlanner((prev) => {
      const currentStops = normalizeRouteStops(prev.routeStops);
      const nextStops = normalizeRouteStops(typeof updater === 'function' ? updater(currentStops) : updater);
      return { ...prev, routeStops: nextStops };
    });
  };
  const updateRouteStop = (index: number, value: string) => {
    setRouteStops((prev) => prev.map((stop, stopIdx) => (stopIdx === index ? value : stop)));
  };
  const reverseRouteStops = () => {
    setRouteStops((prev) => [...prev].reverse());
    setRouteStopKeys((prev) => [...prev].reverse());
  };
  const addWaypoint = () => {
    const insertIndex = Math.max(1, routeStops.length - 1);
    setRouteStops((prev) => {
      const next = [...prev];
      next.splice(next.length - 1, 0, '');
      return next;
    });
    setRouteStopKeys((prev) => {
      const next = [...prev];
      next.splice(insertIndex, 0, makeRouteStopKey());
      return next;
    });
  };
  const removeWaypoint = (index: number) => {
    if (routeStopDropRafRef.current != null) {
      window.cancelAnimationFrame(routeStopDropRafRef.current);
      routeStopDropRafRef.current = null;
    }
    setIsRouteStopDropping(false);
    dragStateRef.current = null;
    setDragState(null);
    setRouteStops((prev) => prev.filter((_, stopIdx) => stopIdx !== index));
    setRouteStopKeys((prev) => prev.filter((_, stopIdx) => stopIdx !== index));
  };
  const reorderWaypoint = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setRouteStops((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setRouteStopKeys((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };
  const startRouteStopDrag = (index: number, clientY: number) => {
    const rowTops = routeStops.map((_, rowIndex) => routeStopRowRefs.current[rowIndex]?.offsetTop ?? 0);
    const rowHeights = routeStops.map((_, rowIndex) => routeStopRowRefs.current[rowIndex]?.offsetHeight ?? 0);
    const nextState = {
      activeIndex: index,
      targetIndex: index,
      startY: clientY,
      currentY: clientY,
      rowTops,
      rowHeights,
    };
    dragStateRef.current = nextState;
    setDragState(nextState);
  };
  const updateRouteStopDrag = (clientY: number) => {
    setDragState((current) => {
      if (!current) return current;
      const deltaY = clientY - current.startY;
      const draggedMidpoint = current.rowTops[current.activeIndex] + deltaY + (current.rowHeights[current.activeIndex] ?? 0) / 2;
      let targetIndex = current.activeIndex;

      while (
        targetIndex < current.rowTops.length - 1 &&
        draggedMidpoint >= (current.rowTops[targetIndex + 1] ?? 0)
      ) {
        targetIndex += 1;
      }

      while (
        targetIndex > 0 &&
        draggedMidpoint <= ((current.rowTops[targetIndex - 1] ?? 0) + (current.rowHeights[targetIndex - 1] ?? 0))
      ) {
        targetIndex -= 1;
      }
      const nextState = {
        ...current,
        currentY: clientY,
        targetIndex,
      };
      dragStateRef.current = nextState;
      return nextState;
    });
  };
  const finishRouteStopDrag = () => {
    const current = dragStateRef.current;
    if (!current) return;
    const { activeIndex, targetIndex } = current;
    setIsRouteStopDropping(true);
    dragStateRef.current = null;
    setDragState(null);
    if (activeIndex !== targetIndex) {
      reorderWaypoint(activeIndex, targetIndex);
    }
    if (routeStopDropRafRef.current != null) {
      window.cancelAnimationFrame(routeStopDropRafRef.current);
    }
    routeStopDropRafRef.current = window.requestAnimationFrame(() => {
      routeStopDropRafRef.current = null;
      setIsRouteStopDropping(false);
    });
  };
  const getRouteStopRowTransform = (index: number) => {
    if (!dragState) return undefined;
    const { activeIndex, targetIndex, startY, currentY, rowTops } = dragState;
    if (index === activeIndex) {
      return `translateY(${currentY - startY}px)`;
    }
    if (activeIndex < targetIndex && index > activeIndex && index <= targetIndex) {
      const prevTop = rowTops[index - 1] ?? rowTops[index] ?? 0;
      return `translateY(-${(rowTops[index] ?? 0) - prevTop}px)`;
    }
    if (activeIndex > targetIndex && index >= targetIndex && index < activeIndex) {
      const nextTop = rowTops[index + 1] ?? rowTops[index] ?? 0;
      return `translateY(${nextTop - (rowTops[index] ?? 0)}px)`;
    }
    return undefined;
  };
  const routeStopIds = useMemo(
    () => routeStops.map((stop) => (graph ? resolveQueryToId(stop, graph) : null)),
    [graph, routeStops]
  );
  useEffect(() => {
    setRouteStopKeys((prev) => {
      if (prev.length === routeStops.length) return prev;
      const next = prev.slice(0, routeStops.length);
      while (next.length < routeStops.length) next.push(makeRouteStopKey());
      return next;
    });
    routeStopRowRefs.current = routeStopRowRefs.current.slice(0, routeStops.length);
  }, [routeStops.length]);
  useEffect(() => {
    return () => {
      if (routeStopDropRafRef.current != null) {
        window.cancelAnimationFrame(routeStopDropRafRef.current);
      }
    };
  }, []);
  const stagingId = routeStopIds[0] ?? null;
  const destinationId = routeStopIds[routeStopIds.length - 1] ?? null;
  const waypointIds = useMemo(
    () => routeStopIds.slice(1, -1).filter((id): id is number => id != null),
    [routeStopIds]
  );
  const hasBlankWaypoint = waypointQueries.some((stop) => !stop.trim());
  const hasInvalidWaypoint = waypointQueries.some((stop, idx) => stop.trim() && routeStopIds[idx + 1] == null);

  const [routeResult, setRouteResult] = useState<{ routes: RouteOption[]; message: string | null; loading: boolean; baselineJumps: number | null }>({
    routes: [],
    message: 'Enter a destination and staging system to calculate a route.',
    loading: false,
    baselineJumps: null,
  });
  const [routeDisplayContext, setRouteDisplayContext] = useState<RouteDisplayContext | null>(null);
  const { copyStatuses, copyText } = useCopyStatuses();
  const [headerCopyOpen, setHeaderCopyOpen] = useState(false);
  const [routeCopyOpenKey, setRouteCopyOpenKey] = useState<string | null>(null);
  const routeWorkersRef = useRef<Worker[]>([]);
  const routeRequestStateRef = useRef<RouteRequestState | null>(null);
  const requestIdRef = useRef(0);
  const jumpTimersWorkersRef = useRef<Worker[]>([]);
  const jumpTimersRequestIdRef = useRef(0);
  const jumpTimersDoneCountRef = useRef(0);
  const [jumpTimersResult, setJumpTimersResult] = useState<{
    routeTravelMinutesByKey: Record<string, number>;
    selectedRouteKey: string | null;
    selectedTimerStops: JumpTimerStop[];
    loading: boolean;
  }>({
    routeTravelMinutesByKey: {},
    selectedRouteKey: null,
    selectedTimerStops: [],
    loading: false,
  });
  const [userSelectedRoute, setUserSelectedRoute] = useState(false);

  useEffect(() => {
    if (!graph) return;
    const handleRouteMessage = (event: MessageEvent<RouteWorkerMessage>) => {
      const data = event.data;
      if (data.requestId !== requestIdRef.current) return;
      const state = routeRequestStateRef.current;
      if (!state || state.requestId !== data.requestId) return;

      if (state.mode === 'waypoint') {
        if (data.type !== 'result' || data.segmentIndex == null || !state.segmentRoutes || !state.segmentBaselines) return;
        state.completedJobs += 1;
        state.segmentRoutes[data.segmentIndex] = data.routes;
        state.segmentBaselines[data.segmentIndex] = data.baselineJumps;
        state.messages[data.segmentIndex] = data.message;

        if (state.completedJobs < state.totalJobs) return;

        let combinedBaselineJumps: number | null = 0;
        for (const segmentBaseline of state.segmentBaselines) {
          if (combinedBaselineJumps == null || segmentBaseline == null) {
            combinedBaselineJumps = null;
          } else {
            combinedBaselineJumps += segmentBaseline;
          }
        }

        const failedIndex = state.segmentRoutes.findIndex((routes) => routes.length === 0);
        if (failedIndex >= 0) {
          const message = `Could not route ${getWaypointSegmentLabel(failedIndex, state.totalJobs)}. ${state.messages[failedIndex] ?? 'No route found.'}`;
          setRouteDisplayContext(state.displayContext);
          setRouteResult({ routes: [], message, loading: false, baselineJumps: combinedBaselineJumps });
          return;
        }

        const routes = state.bridgeOnlyChain
          ? combineWaypointRoutes(state.segmentRoutes, state.waypointIds || [], state.limit)
          : combineWaypointRoutesWithBridgeBudget(state.segmentRoutes, state.waypointIds || [], state.limit, state.totalBridgeBudget || 1);
        const message = routes.length === 0
          ? state.bridgeOnlyChain
            ? 'No routes found through the selected waypoints.'
            : `No routes found through the selected waypoints using ${state.totalBridgeBudget || 1} total bridge${state.totalBridgeBudget === 1 ? '' : 's'}.`
          : null;
        setRouteDisplayContext(state.displayContext);
        setRouteResult({ routes, message, loading: false, baselineJumps: combinedBaselineJumps });
        return;
      }

      const batchIndex = data.segmentIndex ?? 0;
      state.routeBatches[batchIndex] = data.routes;
      if (data.baselineJumps != null) state.baselineJumps = data.baselineJumps;
      if (data.type === 'result') {
        state.completedJobs += 1;
        state.messages[batchIndex] = data.message;
      }

      const routes = mergeTopRoutes(state.routeBatches, state.limit);
      const isDone = state.completedJobs >= state.totalJobs;
      const message = routes.length > 0
        ? null
        : isDone
          ? state.messages.find((value): value is string => !!value) ?? 'No routes found.'
          : 'Computing routes…';
      if (routes.length > 0 || isDone) {
        setRouteDisplayContext(state.displayContext);
      }
      setRouteResult({
        routes,
        message,
        loading: !isDone,
        baselineJumps: state.baselineJumps,
      });
    };

    if (routeWorkersRef.current.length === 0) {
      routeWorkersRef.current = Array.from({ length: getRouteWorkerCount() }, () => {
        const worker = new Worker(new URL('../workers/bridgePlannerWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = handleRouteMessage;
        return worker;
      });
    } else {
      for (const worker of routeWorkersRef.current) worker.onmessage = handleRouteMessage;
    }
    for (const worker of routeWorkersRef.current) {
      worker.postMessage({ type: 'init', graph: { systems: graph.systems } });
    }
  }, [graph]);

  useEffect(() => {
    return () => {
      for (const worker of routeWorkersRef.current) worker.terminate();
      routeWorkersRef.current = [];
      routeRequestStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (jumpTimersWorkersRef.current.length === 0) {
      const workerCount = Math.min(4, Math.max(2, Math.floor((window.navigator.hardwareConcurrency || 4) / 2)));
      const handleTimerMessage = (event: MessageEvent<
        | {
            type: 'route';
            requestId: number;
            routeKey: string;
            travelMinutes: number;
            timerStops?: JumpTimerStop[];
          }
        | {
            type: 'done';
            requestId: number;
          }
      >) => {
        const data = event.data;
        if (data.requestId !== jumpTimersRequestIdRef.current) return;
        if (data.type === 'done') {
          jumpTimersDoneCountRef.current += 1;
          if (jumpTimersDoneCountRef.current >= jumpTimersWorkersRef.current.length) {
            setJumpTimersResult((prev) => ({ ...prev, loading: false }));
          }
          return;
        }
        setJumpTimersResult((prev) => ({
          routeTravelMinutesByKey: {
            ...prev.routeTravelMinutesByKey,
            [data.routeKey]: data.travelMinutes,
          },
          selectedRouteKey: data.timerStops ? data.routeKey : prev.selectedRouteKey,
          selectedTimerStops: data.timerStops ?? prev.selectedTimerStops,
          loading: true,
        }));
      };
      jumpTimersWorkersRef.current = Array.from({ length: workerCount }, () => {
        const worker = new Worker(new URL('../workers/jumpTimersWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = handleTimerMessage;
        return worker;
      });
    }
    return () => {
      for (const worker of jumpTimersWorkersRef.current) worker.terminate();
      jumpTimersWorkersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!graph || destinationId == null || stagingId == null) {
      requestIdRef.current += 1;
      routeRequestStateRef.current = null;
      setRouteResult((prev) => {
        if (prev.routes.length > 0) {
          return { ...prev, message: 'Enter a destination and staging system to calculate a route.', loading: false };
        }
        return { routes: [], message: 'Enter a destination and staging system to calculate a route.', loading: false, baselineJumps: null };
      });
      return;
    }
    if (hasBlankWaypoint || hasInvalidWaypoint) {
      requestIdRef.current += 1;
      routeRequestStateRef.current = null;
      setRouteResult((prev) => {
        if (prev.routes.length > 0) {
          return { ...prev, message: 'Enter valid systems for all waypoints to calculate a route.', loading: false };
        }
        return { routes: [], message: 'Enter valid systems for all waypoints to calculate a route.', loading: false, baselineJumps: null };
      });
      return;
    }
    const workers = routeWorkersRef.current;
    if (workers.length === 0) return;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const limit = Math.max(1, Math.min(25, planner.routesToShow || 5));
    const displayContext = { stagingId, destinationId, waypointIds };
    const routeSettings = {
      excludeZarzakh: settings.excludeZarzakh,
      sameRegionOnly: settings.sameRegionOnly,
      bridgeIntoDestination: settings.bridgeIntoDestination,
      bridgeFromStaging: settings.bridgeFromStaging,
      bridgeCount: settings.bridgeCount,
      bridgeContinuous: settings.bridgeContinuous,
      bridgeOnlyChain: settings.bridgeOnlyChain,
      allowAnsiblex: settings.allowAnsiblex,
      ansiblexes: settings.ansiblexes,
      limitToCynoBeacons: settings.limitToCynoBeacons,
      cynoBeacons: settings.cynoBeacons,
      blacklistEnabled: settings.blacklistEnabled,
      blacklist: settings.blacklist,
    };
    const basePayload = {
      type: 'compute' as const,
      requestId,
      destinationId,
      stagingId,
      waypointIds,
      bridgeRange: planner.bridgeRange,
      routesToShow: planner.routesToShow,
      settings: routeSettings,
    };
    setUserSelectedRoute(false);
    setSelectedRouteKey(null);
    setRouteResult((prev) => ({ ...prev, message: 'Computing routes…', loading: true }));

    if (waypointIds.length > 0) {
      const stopIds = [stagingId, ...waypointIds, destinationId];
      const segmentCount = stopIds.length - 1;
      routeRequestStateRef.current = {
        requestId,
        mode: 'waypoint',
        limit,
        totalJobs: segmentCount,
        completedJobs: 0,
        routeBatches: [],
        messages: Array(segmentCount).fill(null),
        baselineJumps: null,
        segmentRoutes: Array.from({ length: segmentCount }, () => []),
        segmentBaselines: Array(segmentCount).fill(null),
        waypointIds,
        displayContext,
        bridgeOnlyChain: !!settings.bridgeOnlyChain,
        totalBridgeBudget: Math.max(1, Math.min(2, settings.bridgeCount ?? 1)),
      };
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        workers[segmentIndex % workers.length]?.postMessage({
          ...basePayload,
          mode: 'waypoint-segment',
          segmentIndex,
          segmentCount,
          totalBridgeBudget: Math.max(1, Math.min(2, settings.bridgeCount ?? 1)),
          stagingId: stopIds[segmentIndex],
          destinationId: stopIds[segmentIndex + 1],
        });
      }
      return;
    }

    routeRequestStateRef.current = {
      requestId,
      mode: 'pair',
      limit,
      totalJobs: workers.length,
      completedJobs: 0,
      routeBatches: Array.from({ length: workers.length }, () => []),
      messages: Array(workers.length).fill(null),
      baselineJumps: null,
      displayContext,
    };
    workers.forEach((worker, workerIndex) => {
      worker.postMessage({
        ...basePayload,
        mode: 'pair-shard',
        shardIndex: workerIndex,
        shardCount: workers.length,
        segmentIndex: workerIndex,
      });
    });
  }, [
    graph,
    destinationId,
    stagingId,
    waypointIds,
    hasBlankWaypoint,
    hasInvalidWaypoint,
    planner.bridgeRange,
    planner.routesToShow,
    settings.excludeZarzakh,
    settings.sameRegionOnly,
    settings.bridgeIntoDestination,
    settings.bridgeFromStaging,
    settings.bridgeCount,
    settings.bridgeContinuous,
    settings.bridgeOnlyChain,
    settings.allowAnsiblex,
    settings.ansiblexes,
    settings.limitToCynoBeacons,
    settings.cynoBeacons,
    settings.blacklistEnabled,
    settings.blacklist,
  ]);

  const [selectedRouteKey, setSelectedRouteKey] = useState<string | null>(null);

  useEffect(() => {
    if (routeResult.routes.length === 0) {
      if (selectedRouteKey !== null) setSelectedRouteKey(null);
      return;
    }
    if (!selectedRouteKey || !routeResult.routes.some(r => r.key === selectedRouteKey)) {
      setSelectedRouteKey(routeResult.routes[0].key);
    }
  }, [routeResult.routes, selectedRouteKey]);

  useEffect(() => {
    if (!routeResult.loading && routeResult.routes.length > 0 && !userSelectedRoute) {
      setSelectedRouteKey(routeResult.routes[0].key);
    }
  }, [routeResult.loading, routeResult.routes, userSelectedRoute]);

  const selectedRoute = useMemo(() => {
    if (routeResult.routes.length === 0) return null;
    return routeResult.routes.find(r => r.key === selectedRouteKey) ?? routeResult.routes[0];
  }, [routeResult.routes, selectedRouteKey]);
  const displayStagingId = routeDisplayContext?.stagingId ?? stagingId;
  const displayDestinationId = routeDisplayContext?.destinationId ?? destinationId;
  const selectedFuelPerLy = useMemo(() => getPresetFuelPerLy(planner.presetShipClass), [planner.presetShipClass]);
  const selectedRouteIsotopes = useMemo(() => {
    if (!selectedRoute || !isBridgeOnlyMode) return null;
    return calculateRouteIsotopes(selectedRoute, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf);
  }, [selectedRoute, isBridgeOnlyMode, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf]);
  const selectedTimerStops = selectedRouteKey === jumpTimersResult.selectedRouteKey
    ? jumpTimersResult.selectedTimerStops
    : [];

  const nameFor = (id: number | null) => {
    if (id == null) return '—';
    return graph?.namesById?.[String(id)] ?? String(id);
  };
  const securityInfoFor = (id: number | null) => {
    const SEC_COLORS = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
    const security = id == null ? undefined : graph?.systems[String(id)]?.security;
    const value = typeof security === 'number' ? security : 0;
    const index = value <= 0 ? 0 : Math.min(10, Math.ceil(value * 10));
    return {
      color: SEC_COLORS[index] || SEC_COLORS[0],
      label: value.toFixed(1),
    };
  };
  const renderSystemName = (id: number | null) => {
    const { color, label } = securityInfoFor(id);
    return (
      <>
        <span>{nameFor(id)}</span>
        <span style={{ color, fontWeight: 700 }}>{label}</span>
      </>
    );
  };

  const routesForCopy = useMemo(() => routeResult.routes.slice(0, 10), [routeResult.routes]);
  const eveLinksMarkup = useMemo(() => {
    if (!graph || routesForCopy.length === 0) return '';
    const namesById = graph.namesById || {};
    const lines = routesForCopy.map((route) => {
      const chain = getBridgeSequence(route)
        .map((id) => `<a href="showinfo:5//${id}">${namesById[String(id)] ?? String(id)}</a>`)
        .join(' - ');
      const isotopes = isBridgeOnlyMode
        ? calculateRouteIsotopes(route, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf)
        : null;
      const fuelText = isotopes != null ? `, ${formatIsotopes(isotopes)} isotopes` : '';
      return `${chain} (${route.totalJumps}j, ${route.totalBridges}b${fuelText})`;
    });
    const body = lines.join('<br>');
    return `<font size="13" color="#bfffffff"></font><font size="13" color="#ffffffff"><loc>${body}</loc></font>`;
  }, [graph, routesForCopy, isBridgeOnlyMode, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf]);
  const plainTextRoutes = useMemo(() => {
    if (!graph || routesForCopy.length === 0) return '';
    const namesById = graph.namesById || {};
    const lines = routesForCopy.map((route) => {
      const chain = getBridgeSequence(route)
        .map((id) => namesById[String(id)] ?? String(id))
        .join(' - ');
      const isotopes = isBridgeOnlyMode
        ? calculateRouteIsotopes(route, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf)
        : null;
      const fuelText = isotopes != null ? `, ${formatIsotopes(isotopes)} isotopes` : '';
      return `${chain} (${route.totalJumps}j, ${route.totalBridges}b${fuelText})`;
    });
    return lines.join('\n');
  }, [graph, routesForCopy, isBridgeOnlyMode, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf]);
  const buildRouteCopyPayload = useMemo(() => {
    if (!graph) return () => ({ eve: '', plain: '' });
    const namesById = graph.namesById || {};
    return (route: RouteOption) => {
      const ids = getBridgeSequence(route);
      let eveLine = ids.map((id) => `<a href="showinfo:5//${id}">${namesById[String(id)] ?? String(id)}</a>`).join(' - ');
      let plainLine = ids.map((id) => namesById[String(id)] ?? String(id)).join(' - ');
      const isotopes = isBridgeOnlyMode
        ? calculateRouteIsotopes(route, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf)
        : null;
      const fuelText = isotopes != null ? `, ${formatIsotopes(isotopes)} isotopes` : '';
      eveLine += ` (${route.totalJumps}j, ${route.totalBridges}b${fuelText})`;
      plainLine += ` (${route.totalJumps}j, ${route.totalBridges}b${fuelText})`;
      const eve = `<font size="13" color="#bfffffff"></font><font size="13" color="#ffffffff"><loc>${eveLine}</loc></font>`;
      return { eve, plain: plainLine };
    };
  }, [graph, isBridgeOnlyMode, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf]);

  const fitNodeIds = useMemo(() => {
    if (routeResult.routes.length === 0) return [] as number[];
    const ids = new Set<number>();
    for (const route of routeResult.routes) {
      for (const id of getAllRouteIds(route)) ids.add(id);
    }
    if (displayStagingId != null) ids.add(displayStagingId);
    if (displayDestinationId != null) ids.add(displayDestinationId);
    return Array.from(ids.values());
  }, [routeResult.routes, displayStagingId, displayDestinationId]);

  const displayRoutes = useMemo(() => {
    if (!routeResult.loading) {
      return routeResult.routes.map((route) => ({ route, placeholder: false }));
    }
    const count = Math.max(planner.routesToShow, routeResult.routes.length);
    return Array.from({ length: count }, (_, idx) => ({
      route: routeResult.routes[idx] ?? null,
      placeholder: routeResult.routes[idx] == null,
    }));
  }, [routeResult.loading, routeResult.routes, planner.routesToShow]);

  useEffect(() => {
    if (!isBridgeOnlyMode || routeResult.routes.length === 0) {
      jumpTimersRequestIdRef.current += 1;
      setJumpTimersResult({ routeTravelMinutesByKey: {}, selectedRouteKey: null, selectedTimerStops: [], loading: false });
      return;
    }
    jumpTimersRequestIdRef.current += 1;
    const requestId = jumpTimersRequestIdRef.current;

    if (planner.timerMode === 'jump-asap') {
      const routeTravelMinutesByKey: Record<string, number> = {};
      let selectedTimerStops: JumpTimerStop[] = [];
      for (const route of routeResult.routes) {
        const timerStops = calculateJumpTimerStops(
          route,
          planner.presetFatigueReduction,
          planner.startingFatigueMinutes,
          planner.startingActivationMinutes,
          'jump-asap'
        );
        routeTravelMinutesByKey[route.key] = getRouteTravelMinutes(timerStops);
        if (route.key === selectedRouteKey) selectedTimerStops = timerStops;
      }
      setJumpTimersResult({
        routeTravelMinutesByKey,
        selectedRouteKey,
        selectedTimerStops,
        loading: false,
      });
      return;
    }

    const workers = jumpTimersWorkersRef.current;
    if (workers.length === 0) {
      setJumpTimersResult({ routeTravelMinutesByKey: {}, selectedRouteKey: null, selectedTimerStops: [], loading: false });
      return;
    }

    setJumpTimersResult({ routeTravelMinutesByKey: {}, selectedRouteKey: null, selectedTimerStops: [], loading: true });
    jumpTimersDoneCountRef.current = 0;
    const selectedRouteForTimers = selectedRouteKey
      ? routeResult.routes.find((route) => route.key === selectedRouteKey) ?? null
      : null;
    const remainingRoutes = selectedRouteForTimers
      ? routeResult.routes.filter((route) => route.key !== selectedRouteForTimers.key)
      : routeResult.routes;
    const routeBatches = workers.map((_, workerIndex) => remainingRoutes.filter((_, routeIndex) => routeIndex % workers.length === workerIndex));
    if (selectedRouteForTimers) routeBatches[0] = [selectedRouteForTimers, ...(routeBatches[0] ?? [])];

    workers.forEach((worker, workerIndex) => {
      worker.postMessage({
        type: 'compute',
        requestId,
        routes: routeBatches[workerIndex] ?? [],
        selectedRouteKey,
        fatigueReduction: planner.presetFatigueReduction,
        startingFatigueMinutes: planner.startingFatigueMinutes,
        startingActivationMinutes: planner.startingActivationMinutes,
        timerMode: planner.timerMode,
      });
    });
  }, [
    isBridgeOnlyMode,
    routeResult.routes,
    selectedRouteKey,
    planner.presetFatigueReduction,
    planner.startingFatigueMinutes,
    planner.startingActivationMinutes,
    planner.timerMode,
  ]);

  return (
    <section className="grid gap-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <h1 className="text-3xl font-semibold mb-2">Bridge Planner</h1>
        <p className="text-slate-600 dark:text-slate-300">
          Find the best titan parking system and bridge endpoint to minimize jumps to your destination.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <div className="grid gap-4">
          <section className="grid gap-4 md:grid-cols-2 bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="md:col-span-2 grid gap-2">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Route mode</div>
              <div className="relative grid grid-cols-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-1 overflow-hidden">
                <div
                  className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-amber-500 shadow-sm transition-transform duration-200 ease-out"
                  style={{ transform: isBridgeOnlyMode ? 'translateX(100%)' : 'translateX(0%)' }}
                  aria-hidden="true"
                />
                {([
                  { value: 'bridge-gate', label: 'Bridge + gate' },
                  { value: 'bridge-only', label: 'Bridge only' },
                ] as const).map((option) => {
                  const isActive = travelMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={
                        'relative z-10 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ' +
                        (isActive
                          ? 'text-white'
                          : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white')
                      }
                      aria-pressed={isActive}
                      onClick={() => setSettings((prev) => ({
                        ...prev,
                        bridgeOnlyChain: option.value === 'bridge-only',
                      }))}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-2 grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-end gap-3">
              <label className="grid min-w-0 gap-2">
                <span>Starting system</span>
                <AutocompleteInput
                  graph={graph}
                  value={stagingQuery}
                  onChange={(value) => updateRouteStop(0, value)}
                  placeholder="e.g. UALX-3"
                />
              </label>

              <button
                type="button"
                className="mb-px h-10 w-11 rounded-md inline-flex items-center justify-center border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                onClick={reverseRouteStops}
                aria-label="Reverse route"
                title="Reverse route"
              >
                <Icon name="reverse-route" size={18} />
              </button>

              <label className="grid min-w-0 gap-2">
                <span>Destination system</span>
                <AutocompleteInput
                  graph={graph}
                  value={targetQuery}
                  onChange={(value) => updateRouteStop(routeStops.length - 1, value)}
                  placeholder="e.g. C-J6MT"
                />
              </label>
            </div>

            <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/30 px-3 py-2">
              <div className="text-sm text-slate-700 dark:text-slate-300">
                {waypointQueries.length === 0
                  ? 'No waypoints configured.'
                  : `Waypoints: ${waypointQueries.map((stop) => stop.trim() || '—').join(' → ')}`}
              </div>
              <button
                type="button"
                className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center justify-center gap-1 leading-none"
                onClick={() => setShowWaypointsModal(true)}
              >
                <Icon name="gear" size={16} />
                <span>{waypointQueries.length > 0 ? 'Edit route stops…' : 'Add waypoints…'}</span>
              </button>
            </div>

            <div className="grid gap-2 md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="bridge-range-slider">Bridge range: {planner.bridgeRange.toFixed(1)} ly</label>
                <div className="relative" ref={rangePopoverRef}>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"
                    onClick={() => setRangePopoverOpen((open) => !open)}
                  >
                    Presets
                    <Icon name="chevron-down" size={14} />
                  </button>
                  {rangePopoverOpen && (
                    <div className="absolute right-0 top-full mt-2 inline-block rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-3 z-20">
                      <div className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                        <span>Ship class</span>
                        <div className="grid gap-1" style={jdcSliderWidth ? { width: `${jdcSliderWidth}px`, maxWidth: `${jdcSliderWidth}px` } : undefined}>
                          {RANGE_PRESETS.map((preset) => {
                            const isSelected = planner.presetShipClass === preset.label;
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => {
                                  const range = Number((preset.base * (1 + 0.2 * planner.presetJdc)).toFixed(1));
                                  setPlanner((prev) => ({
                                    ...prev,
                                    presetShipClass: preset.label,
                                    bridgeRange: range,
                                    presetFatigueReduction: preset.fatigueReduction,
                                  }));
                                }}
                                className={
                                  "w-full text-left px-2 py-1 rounded border text-xs transition flex items-center gap-2 " +
                                  (isSelected
                                    ? "border-amber-400 bg-amber-50/80 dark:bg-amber-900/20 text-slate-900 dark:text-slate-100"
                                    : "border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 text-slate-700 dark:text-slate-300 hover:border-amber-300")
                                }
                                aria-pressed={isSelected}
                              >
                                <Icon ship={preset.label} size={16} />
                                <span>{preset.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid gap-1 text-xs text-slate-600 dark:text-slate-300 mt-2">
                        <span>Jump Drive Calibration</span>
                        <SegmentedSlider
                          containerRef={jdcSliderRef}
                          options={[0, 1, 2, 3, 4, 5].map((lvl) => ({ label: String(lvl), value: String(lvl) }))}
                          value={String(planner.presetJdc)}
                          onChange={(value) => {
                            const jdc = Math.max(0, Math.min(5, Number(value)));
                            const baseRange = RANGE_PRESETS.find((p) => p.label === planner.presetShipClass)?.base ?? planner.bridgeRange;
                            const range = Number((baseRange * (1 + 0.2 * jdc)).toFixed(1));
                            setPlanner((prev) => ({ ...prev, presetJdc: jdc, bridgeRange: range }));
                          }}
                          height={28}
                          radius={6}
                          labelClassName="text-xs leading-5"
                          getColorForValue={() => 'bg-amber-500'}
                          disableInitialAnimation
                        />
                      </div>
                      <div className="grid gap-1 text-xs text-slate-600 dark:text-slate-300 mt-2">
                        <span>Jump Fuel Conservation</span>
                        <SegmentedSlider
                          options={[0, 1, 2, 3, 4, 5].map((lvl) => ({ label: String(lvl), value: String(lvl) }))}
                          value={String(planner.presetJfc)}
                          onChange={(value) => {
                            const jfc = Math.max(0, Math.min(5, Number(value)));
                            setPlanner((prev) => ({ ...prev, presetJfc: jfc }));
                          }}
                          height={28}
                          radius={6}
                          labelClassName="text-xs leading-5"
                          getColorForValue={() => 'bg-amber-500'}
                          disableInitialAnimation
                        />
                      </div>
                      <div className="grid gap-1 text-xs text-slate-600 dark:text-slate-300 mt-2">
                        <span>Jump Freighter</span>
                        <SegmentedSlider
                          options={[0, 1, 2, 3, 4, 5].map((lvl) => ({ label: String(lvl), value: String(lvl) }))}
                          value={String(planner.presetJf)}
                          onChange={(value) => {
                            const jf = Math.max(0, Math.min(5, Number(value)));
                            setPlanner((prev) => ({ ...prev, presetJf: jf }));
                          }}
                          height={28}
                          radius={6}
                          labelClassName="text-xs leading-5"
                          getColorForValue={() => 'bg-amber-500'}
                          disableInitialAnimation
                        />
                      </div>
                      <div className="grid gap-1 text-xs text-slate-600 dark:text-slate-300 mt-2">
                        <span>Jump fatigue reduction</span>
                        <SegmentedSlider
                          options={FATIGUE_REDUCTION_OPTIONS.map((pct) => ({ label: `${pct}%`, value: String(pct) }))}
                          value={String(planner.presetFatigueReduction)}
                          onChange={(value) => {
                            setPlanner((prev) => ({
                              ...prev,
                              presetFatigueReduction: clampFatigueReduction(Number(value)),
                            }));
                          }}
                          targetWidth={presetControlWidth}
                          height={28}
                          radius={6}
                          labelClassName="text-xs leading-5"
                          getColorForValue={() => 'bg-amber-500'}
                          disableInitialAnimation
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <input
                id="bridge-range-slider"
                type="range"
                className="accent-amber-600 w-full"
                min={1}
                max={10}
                step={0.5}
                value={planner.bridgeRange}
                onChange={(e) => setPlanner((prev) => ({ ...prev, bridgeRange: Number(e.target.value) }))}
              />
            </div>

            <fieldset className="md:col-span-2 border border-gray-200 dark:border-gray-700 rounded-md p-3">
              <legend className="px-1 text-sm text-gray-700 dark:text-gray-300">Options</legend>
              <div className="flex flex-wrap items-center gap-3">
                {!isBridgeOnlyMode && (
                  <>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={!!settings.bridgeIntoDestination}
                        onChange={(e) => setSettings({
                          ...settings,
                          bridgeIntoDestination: e.target.checked,
                          bridgeFromStaging: e.target.checked && settings.bridgeCount === 1 ? false : settings.bridgeFromStaging,
                        })}
                      />
                      <span>Bridge into destination</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={!!settings.bridgeFromStaging}
                        onChange={(e) => setSettings({
                          ...settings,
                          bridgeFromStaging: e.target.checked,
                          bridgeIntoDestination: e.target.checked && settings.bridgeCount === 1 ? false : settings.bridgeIntoDestination,
                        })}
                      />
                      <span>Bridge from starting system</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <span>Bridges</span>
                      <select
                        className="rounded border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-2 py-1 text-xs"
                        value={settings.bridgeCount}
                        onChange={(e) => {
                          const nextCount = Math.max(1, Math.min(2, Number(e.target.value)));
                          setSettings({
                            ...settings,
                            bridgeCount: nextCount,
                            bridgeContinuous: nextCount === 2 ? settings.bridgeContinuous : false,
                            bridgeIntoDestination: nextCount === 1 && settings.bridgeFromStaging ? false : settings.bridgeIntoDestination,
                            bridgeFromStaging: nextCount === 1 && settings.bridgeIntoDestination ? false : settings.bridgeFromStaging,
                          });
                        }}
                      >
                        {[1, 2].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {settings.bridgeCount === 2 && !isBridgeOnlyMode && (
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={!!settings.bridgeContinuous}
                      onChange={(e) => setSettings({ ...settings, bridgeContinuous: e.target.checked })}
                    />
                    <span>Continuous bridges</span>
                  </label>
                )}
                {isBridgeOnlyMode && (
                  <>
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      Uses only titan bridges. Gate travel and Ansiblex options are hidden in this mode.
                    </span>
                    <label className="inline-flex items-center gap-2">
                      <span>Starting fatigue</span>
                      <input
                        type="number"
                        className="w-20 rounded border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-2 py-1 text-xs"
                        min={0}
                        max={300}
                        step={1}
                        value={planner.startingFatigueMinutes}
                        onChange={(e) => {
                          const value = Math.max(0, Math.min(300, Number(e.target.value) || 0));
                          setPlanner((prev) => ({ ...prev, startingFatigueMinutes: value }));
                        }}
                        aria-label="Starting jump fatigue in minutes"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">min</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <span>Starting activation</span>
                      <input
                        type="number"
                        className="w-20 rounded border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-2 py-1 text-xs"
                        min={0}
                        max={30}
                        step={1}
                        value={planner.startingActivationMinutes}
                        onChange={(e) => {
                          const value = Math.max(0, Math.min(30, Number(e.target.value) || 0));
                          setPlanner((prev) => ({ ...prev, startingActivationMinutes: value }));
                        }}
                        aria-label="Starting jump activation cooldown in minutes"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">min</span>
                    </label>
                  </>
                )}
                {!isBridgeOnlyMode && (
                  <>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={!!settings.allowAnsiblex}
                        onChange={(e) => setSettings({ ...settings, allowAnsiblex: e.target.checked })}
                      />
                      <span>Allow Ansiblex jump bridges</span>
                    </label>
                    <button
                      type="button"
                      className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center justify-center gap-1 leading-none"
                      onClick={() => setShowAnsiblexModal(true)}
                    >
                      <Icon name="gear" size={16} />
                      <span className="inline-block align-middle">Configure…</span>
                    </button>
                  </>
                )}
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={!!settings.limitToCynoBeacons}
                    onChange={(e) => setSettings({ ...settings, limitToCynoBeacons: e.target.checked })}
                  />
                  <span>Only bridge to cyno beacons</span>
                </label>
                <button
                  type="button"
                  className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center justify-center gap-1 leading-none"
                  onClick={() => setShowCynoBeaconModal(true)}
                >
                  <Icon name="gear" size={16} />
                  <span className="inline-block align-middle">Configure…</span>
                </button>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={!!settings.blacklistEnabled}
                    onChange={(e) => setSettings({ ...settings, blacklistEnabled: e.target.checked })}
                  />
                  <span>Enable system blacklist</span>
                </label>
                <button
                  type="button"
                  className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center justify-center gap-1 leading-none"
                  onClick={() => setShowBlacklistModal(true)}
                >
                  <Icon name="gear" size={16} />
                  <span className="inline-block align-middle">Configure…</span>
                </button>
              </div>
            </fieldset>
          </section>

          <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Routes</h2>
                {routeResult.loading && <span className="text-xs text-slate-500">Updating…</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {(() => {
                  const headerCopyState = copyStatuses.header ?? null;
                  return (
                <div className="relative">
                  <div
                    className="relative"
                    onMouseLeave={() => setHeaderCopyOpen(false)}
                  >
                    <button
                      type="button"
                      className={getCopyButtonClass(headerCopyState, "px-2 py-1 text-xs rounded border inline-flex items-center gap-1 transition-colors")}
                      disabled={!eveLinksMarkup && !plainTextRoutes}
                      aria-label="Copy"
                      onMouseEnter={() => setHeaderCopyOpen(true)}
                    >
                      <Icon
                        name={getCopyButtonIconName(headerCopyState)}
                        size={14}
                        color={getCopyButtonIconColor(headerCopyState)}
                      />
                      <span>{getCopyButtonLabel(headerCopyState)}</span>
                    </button>
                    {headerCopyOpen && (
                      <div className="absolute right-0 top-full pt-1 z-10">
                        <div
                          className="min-w-[180px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden"
                          onMouseEnter={() => setHeaderCopyOpen(true)}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setHeaderCopyOpen(false);
                              if (eveLinksMarkup) copyText(eveLinksMarkup, 'header');
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                            disabled={!eveLinksMarkup}
                          >
                            Copy EVE in-game links
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setHeaderCopyOpen(false);
                              if (plainTextRoutes) copyText(plainTextRoutes, 'header');
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                            disabled={!plainTextRoutes}
                          >
                            Copy plain text
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                  );
                })()}
                <span>Show</span>
                <select
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-2 py-1 text-xs"
                  value={planner.routesToShow}
                  onChange={(e) => setPlanner((prev) => ({ ...prev, routesToShow: Number(e.target.value) }))}
                >
                  {[5, 10, 15, 20, 25].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <span>routes</span>
              </div>
            </div>
            {!routeResult.loading && routeResult.routes.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                {routeResult.message || 'No routes available.'}
              </p>
            ) : (
              <div className="mt-3 grid gap-3">
                {displayRoutes.map((item, idx) => {
                  const route = item.route;
                  if (!route) {
                    return (
                      <div
                        key={`placeholder-${idx}`}
                        className="relative w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-gray-900/30 px-4 py-3"
                        aria-hidden="true"
                      >
                        <div className="h-4 w-3/4 rounded bg-slate-200/80 dark:bg-slate-700/50" />
                        <div className="mt-2 h-3 w-2/3 rounded bg-slate-200/70 dark:bg-slate-700/40" />
                      </div>
                    );
                  }

                  const isSelected = selectedRoute?.key === route.key;
                  const routeTravelMinutes = isBridgeOnlyMode ? jumpTimersResult.routeTravelMinutesByKey[route.key] ?? null : null;
                  const chainIds = getBridgeSequence(route);
                  const displayChainIds = displayStagingId != null && chainIds[0] !== displayStagingId ? [displayStagingId, ...chainIds] : chainIds;
                  const stopChainIds = [
                    displayStagingId,
                    ...(route.waypointIds ?? []),
                    displayDestinationId,
                  ].filter((id): id is number => id != null);
                  const gateDetails = route.bridgeLegs
                    .map((leg, legIdx) => leg.approachJumps > 0 ? `${leg.approachJumps}j to park${route.bridgeLegs.length > 1 ? ` ${legIdx + 1}` : ''}` : null)
                    .filter((value): value is string => value != null);
                  if (route.postBridgeJumps > 0) gateDetails.push(`${route.postBridgeJumps}j after`);
                  const routeBridgeLy = getRouteBridgeLy(route);
                  const routeIsotopes = isBridgeOnlyMode
                    ? calculateRouteIsotopes(route, selectedFuelPerLy, planner.presetJfc, planner.presetShipClass, planner.presetJf)
                    : null;
                  const routeCopyState = copyStatuses[route.key] ?? null;
                  return (
                    <div
                      key={route.key}
                      className={
                        "relative w-full rounded-lg border px-4 py-3 transition " +
                        (isSelected
                          ? "border-amber-400 bg-amber-50/80 dark:bg-amber-900/20 shadow-sm"
                          : "border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-gray-900/40 hover:border-amber-300")
                      }
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedRouteKey(route.key);
                        setUserSelectedRoute(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedRouteKey(route.key);
                          setUserSelectedRoute(true);
                        }
                      }}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 text-left pointer-events-none">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                            {displayChainIds.map((id, chainIdx) => (
                              <span key={`${route.key}-${id}-${chainIdx}`} className="inline-flex items-center gap-x-1 gap-y-0.5 flex-wrap">
                                {chainIdx > 0 && <span aria-hidden="true">→</span>}
                                {renderSystemName(id)}
                              </span>
                            ))}
                            {displayDestinationId != null && displayChainIds[displayChainIds.length - 1] !== displayDestinationId && (
                              <span className="inline-flex items-center gap-x-1 gap-y-0.5 flex-wrap">
                                <span aria-hidden="true">→</span>
                                {renderSystemName(displayDestinationId)}
                              </span>
                            )}
                          </div>
                          {route.waypointIds && route.waypointIds.length > 0 && (
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                              <span>Stops:</span>
                              {stopChainIds.map((id, chainIdx) => (
                                <span key={`${route.key}-stop-${id}-${chainIdx}`} className="inline-flex items-center gap-x-1 gap-y-0.5 flex-wrap">
                                  {chainIdx > 0 && <span aria-hidden="true">→</span>}
                                  {renderSystemName(id)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 flex items-center gap-2 self-start" onClick={(event) => event.stopPropagation()}>
                          {idx === 0 && (
                            <span className="text-[10px] uppercase tracking-wide rounded-full bg-amber-200 text-amber-900 px-2 py-0.5">
                              Best
                            </span>
                          )}
                          <div className="relative pointer-events-auto">
                            <div
                              className="relative"
                              onMouseLeave={() => setRouteCopyOpenKey(null)}
                            >
                              <button
                                type="button"
                                className={getCopyButtonClass(routeCopyState, "px-2 py-1 text-xs rounded border inline-flex items-center gap-1 transition-colors")}
                                aria-label="Copy"
                                onMouseEnter={() => setRouteCopyOpenKey(route.key)}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Icon
                                  name={getCopyButtonIconName(routeCopyState)}
                                  size={14}
                                  color={getCopyButtonIconColor(routeCopyState)}
                                />
                                <span>{getCopyButtonLabel(routeCopyState)}</span>
                              </button>
                              {routeCopyOpenKey === route.key && (
                                <div className="absolute right-0 top-full pt-1 z-10">
                                  <div
                                    className="min-w-[180px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden"
                                    onMouseEnter={() => setRouteCopyOpenKey(route.key)}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const payload = buildRouteCopyPayload(route);
                                        setRouteCopyOpenKey(null);
                                        if (payload.eve) copyText(payload.eve, route.key);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                                    >
                                      Copy EVE in-game links
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const payload = buildRouteCopyPayload(route);
                                        setRouteCopyOpenKey(null);
                                        if (payload.plain) copyText(payload.plain, route.key);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                                    >
                                      Copy plain text
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300 pointer-events-none">
                        <span className="min-w-0">
                          {routeBridgeLy.toFixed(2)} ly
                          {routeTravelMinutes != null ? ` • ${formatTimerMinutes(routeTravelMinutes)}` : ''}
                          {isBridgeOnlyMode && routeTravelMinutes == null && jumpTimersResult.loading ? ' • calculating…' : ''}
                          {gateDetails.length > 0 ? ` • ${gateDetails.join(' • ')}` : ''}
                          {routeIsotopes != null ? ` • ${formatIsotopes(routeIsotopes)} isotopes` : ''}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {route.totalJumps} jump{route.totalJumps === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="grid gap-4">
            <BridgePlannerMap
              graph={graph}
              namesById={graph?.namesById || {}}
              stagingId={displayStagingId}
              destinationId={displayDestinationId}
              bridgeLegs={selectedRoute?.bridgeLegs ?? null}
              postBridgePaths={selectedRoute?.postBridgePaths ?? null}
              fitNodeIds={fitNodeIds}
              bridgeRange={planner.bridgeRange}
              settings={{
                excludeZarzakh: settings.excludeZarzakh,
                sameRegionOnly: settings.sameRegionOnly,
                allowAnsiblex: settings.allowAnsiblex,
                ansiblexes: settings.ansiblexes,
                cynoBeacons: settings.cynoBeacons,
              }}
              statusMessage={routeResult.message}
              baselineJumps={routeResult.baselineJumps}
              onSystemDoubleClick={(id) => {
                const name = graph?.namesById?.[String(id)] ?? String(id);
                updateRouteStop(routeStops.length - 1, name);
              }}
            />
            {isBridgeOnlyMode && (
              <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-semibold">Jump timers</h2>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <span>Mode</span>
                      <select
                        className="rounded border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-2 py-1 text-xs"
                        value={planner.timerMode}
                        onChange={(event) => {
                          const timerMode = event.target.value === 'jump-asap' ? 'jump-asap' : 'fastest-arrival';
                          setPlanner((prev) => ({ ...prev, timerMode }));
                        }}
                      >
                        <option value="fastest-arrival">Fastest arrival</option>
                        <option value="jump-asap">Jump ASAP</option>
                      </select>
                    </label>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 text-right">
                    <span>Fatigue reduction {planner.presetFatigueReduction}%</span>
                    {selectedRouteIsotopes != null && (
                      <span> • {formatIsotopes(selectedRouteIsotopes)} isotopes</span>
                    )}
                  </div>
                </div>
                {(planner.startingFatigueMinutes > 0 || planner.startingActivationMinutes > 0) && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Starts with {formatTimerMinutes(planner.startingFatigueMinutes)} fatigue and {formatTimerMinutes(planner.startingActivationMinutes)} activation.
                  </p>
                )}
                {!selectedRoute ? (
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Select a route to see timer details.</p>
                ) : jumpTimersResult.loading && selectedTimerStops.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Calculating jump timers…</p>
                ) : selectedTimerStops.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No bridge legs available for timer calculation.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="py-2 pr-3 font-medium whitespace-nowrap w-16">Stop</th>
                          <th className="py-2 pr-3 font-medium w-[28%]">Leg</th>
                          <th className="py-2 pr-3 font-medium whitespace-nowrap w-24">Distance</th>
                          <th className="py-2 pr-3 font-medium whitespace-nowrap w-24">Activation</th>
                          <th className="py-2 pr-3 font-medium whitespace-nowrap w-24">Fatigue</th>
                          <th className="py-2 font-medium whitespace-nowrap w-20">Arrival</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-slate-600 dark:text-slate-300">
                        {selectedTimerStops.map((stop) => (
                          <tr key={`${stop.fromId}-${stop.toId}-${stop.index}`}>
                            <td className="py-2 pr-3 whitespace-nowrap">
                              <span className="font-medium text-slate-900 dark:text-slate-100">{stop.index}</span>
                              <span className="ml-1 text-slate-500 dark:text-slate-400">{nameFor(stop.toId)}</span>
                            </td>
                            <td className="py-2 pr-3 min-w-[140px]">
                              {nameFor(stop.fromId)} → {nameFor(stop.toId)}
                            </td>
                            <td className="py-2 pr-3 whitespace-nowrap w-24">
                              {stop.bridgeLy.toFixed(2)} ly
                            </td>
                            <td className="py-2 pr-3 whitespace-nowrap w-24">{formatTimerMinutes(stop.activationMinutes)}</td>
                            <td className="py-2 pr-3 whitespace-nowrap w-24">{formatTimerMinutes(stop.fatigueAfterJumpMinutes)}</td>
                            <td className="py-2 whitespace-nowrap w-20">{formatRelativeTimer(stop.arrivalMinutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Usually, jumping ASAP is fastest, so both modes often match.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>

      {showWaypointsModal && (
        <ModalShell
          onClose={() => setShowWaypointsModal(false)}
          panelClassName="w-full max-w-[640px] overflow-visible rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-4"
          labelledBy="route-stops-modal-title"
        >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="route-stops-modal-title" className="text-lg font-semibold">Route stops</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Manage the ordered list of systems the planner must route through.
                </p>
              </div>
              <button
                type="button"
                className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setShowWaypointsModal(false)}
                aria-label="Close"
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="grid gap-3">
              {routeStops.map((stop, index) => {
                const isStart = index === 0;
                const isDestination = index === routeStops.length - 1;
                const stopLabel = isStart ? 'Start' : isDestination ? 'End' : `Via ${index}`;
                const isDropTarget = dragState?.targetIndex === index && dragState.activeIndex !== index;
                const isDraggedRow = dragState?.activeIndex === index;
                const rowTransform = getRouteStopRowTransform(index);
                return (
                  <div
                    key={routeStopKeys[index] ?? `route-stop-${index}`}
                    ref={(node) => {
                      routeStopRowRefs.current[index] = node;
                    }}
                    className={
                      "relative flex items-center gap-2 rounded-md border bg-white dark:bg-gray-900 px-2.5 py-2 transition-colors cursor-grab active:cursor-grabbing " +
                      (isDropTarget
                        ? "border-amber-400 bg-amber-50/80 dark:bg-amber-900/20"
                        : "border-gray-200 dark:border-gray-700") +
                      (isDraggedRow ? " z-20 shadow-md" : "")
                    }
                    style={{
                      transform: rowTransform,
                      transition: (isDraggedRow || isRouteStopDropping)
                        ? 'none'
                        : 'transform 180ms ease, background-color 180ms ease, border-color 180ms ease',
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      const target = event.target as HTMLElement;
                      if (target.closest('input, button, ul, li')) return;
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      startRouteStopDrag(index, event.clientY);
                    }}
                    onPointerMove={(event) => {
                      if (dragState?.activeIndex !== index) return;
                      updateRouteStopDrag(event.clientY);
                    }}
                    onPointerUp={(event) => {
                      if (dragState?.activeIndex !== index) return;
                      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
                      finishRouteStopDrag();
                    }}
                    onPointerCancel={(event) => {
                      if (dragState?.activeIndex !== index) return;
                      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
                      if (routeStopDropRafRef.current != null) {
                        window.cancelAnimationFrame(routeStopDropRafRef.current);
                        routeStopDropRafRef.current = null;
                      }
                      setIsRouteStopDropping(false);
                      dragStateRef.current = null;
                      setDragState(null);
                    }}
                  >
                    <div className="shrink-0 w-8 h-8 rounded border border-gray-300 dark:border-gray-700 inline-flex items-center justify-center text-slate-500 dark:text-slate-400">
                      <Icon name="line-3-horizontal" size={15} />
                    </div>
                    <div
                      className={
                        'shrink-0 w-14 rounded-md px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide ' +
                        (isStart
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : isDestination
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'bg-slate-200/70 text-slate-700 dark:bg-slate-800 dark:text-slate-300')
                      }
                    >
                      {stopLabel}
                    </div>
                    <div className="min-w-0 flex-1">
                      <AutocompleteInput
                        compact
                        graph={graph}
                        value={stop}
                        onChange={(value) => updateRouteStop(index, value)}
                        placeholder={isStart ? 'e.g. UALX-3' : isDestination ? 'e.g. C-J6MT' : 'Waypoint system'}
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        className="w-8 h-8 rounded border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center justify-center"
                        onClick={() => removeWaypoint(index)}
                        aria-label={isStart ? 'Remove start system' : isDestination ? 'Remove destination system' : `Remove waypoint ${index}`}
                        title={isStart ? 'Remove start system' : isDestination ? 'Remove destination system' : `Remove waypoint ${index}`}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-2"
                onClick={addWaypoint}
              >
                <Icon name="plus" size={16} />
                <span>Add waypoint</span>
              </button>
              <button
                type="button"
                className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setShowWaypointsModal(false)}
              >
                Done
              </button>
            </div>
        </ModalShell>
      )}

      {showAnsiblexModal && (
        <SharedAnsiblexModal
          onClose={() => setShowAnsiblexModal(false)}
          value={settings.ansiblexes || []}
          onChange={(list) => setSettings(s => ({ ...s, ansiblexes: list }))}
        />
      )}
      {showCynoBeaconModal && (
        <CynoBeaconModal
          onClose={() => setShowCynoBeaconModal(false)}
          value={settings.cynoBeacons || []}
          onChange={(list) => setSettings(s => ({ ...s, cynoBeacons: list }))}
        />
      )}
      {showBlacklistModal && (
        <BlacklistModal
          onClose={() => setShowBlacklistModal(false)}
          value={settings.blacklist || []}
          onChange={(list) => setSettings(s => ({ ...s, blacklist: list }))}
        />
      )}
    </section>
  );
}
