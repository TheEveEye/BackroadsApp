import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { Icon } from '../components/Icon';
import { AnsiblexModal as SharedAnsiblexModal } from '../components/AnsiblexModal';
import { BridgePlannerMap } from '../components/BridgePlannerMap';
import { SegmentedSlider } from '../components/SegmentedSlider';

//const LY = 9.4607e15;

type PlannerState = {
  targetQuery: string;
  stagingQuery: string;
  bridgeRange: number;
  routesToShow: number;
  presetShipClass: string;
  presetJdc: number;
};

type RouteOption = {
  key: string;
  travelPath: number[];
  postBridgePath: number[];
  parkingId: number;
  bridgeEndpointId: number;
  travelJumps: number;
  postBridgeJumps: number;
  totalJumps: number;
  bridgeLy: number;
  midTravelPath?: number[] | null;
  parking2Id?: number | null;
  bridgeEndpoint2Id?: number | null;
  midTravelJumps?: number;
  bridge2Ly?: number;
};

const RANGE_PRESETS = [
  { label: 'Black Ops', base: 4.0 }, // 8.0 at JDC 5
  { label: 'Carrier Jump', base: 3.5 }, // 7.0 at JDC 5
  { label: 'Carrier Conduit', base: 3.5 }, // 7.0 at JDC 5
  { label: 'Dreadnought', base: 3.5 }, // 7.0 at JDC 5
  { label: 'Force Auxiliary', base: 3.5 }, // 7.0 at JDC 5
  { label: 'Jump Freighter', base: 5.0 }, // 10.0 at JDC 5
  { label: 'Lancer Dreadnought', base: 4.0 }, // 8.0 at JDC 5
  { label: 'Rorqual', base: 5.0 }, // 10.0 at JDC 5
  { label: 'Supercarrier Jump', base: 3.0 }, // 6.0 at JDC 5
  { label: 'Titan Bridge', base: 3.0 }, // 6.0 at JDC 5
  { label: 'Titan Jump', base: 3.0 }, // 6.0 at JDC 5
] as const;

export function BridgePlanner() {
  const UI_KEY = 'br.bridgePlanner.ui.v1';
  const SETTINGS_STORAGE_KEY = 'br.settings.v1';
  const base = (import.meta as any).env?.BASE_URL || '/';
  const shipIconByLabel: Record<string, string> = {
    'Black Ops': 'battleship.png',
    'Carrier Jump': 'carrier.png',
    'Carrier Conduit': 'carrier.png',
    'Dreadnought': 'dreadnought.png',
    'Force Auxiliary': 'force_auxiliary.png',
    'Lancer Dreadnought': 'dreadnought.png',
    'Rorqual': 'industrial_capital.png',
    'Jump Freighter': 'industrial_capital.png',
    'Supercarrier Jump': 'supercarrier.png',
    'Titan Bridge': 'titan.png',
    'Titan Jump': 'titan.png',
  };

  const [graph, setGraph] = useState<GraphData | null>(() => (window as any).appGraph || null);
  const [showAnsiblexModal, setShowAnsiblexModal] = useState(false);
  const [settings, setSettings] = useState<{ excludeZarzakh: boolean; sameRegionOnly: boolean; titanBridgeFirstJump: boolean; bridgeIntoDestination: boolean; bridgeFromStaging: boolean; bridgeCount: number; bridgeContinuous: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }> }>(() => {
    const defaults = { excludeZarzakh: true, sameRegionOnly: false, titanBridgeFirstJump: false, bridgeIntoDestination: false, bridgeFromStaging: false, bridgeCount: 1, bridgeContinuous: false, allowAnsiblex: false, ansiblexes: [] as Array<{ from: number; to: number; enabled?: boolean }> };
    try {
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
            allowAnsiblex: typeof parsed.allowAnsiblex === 'boolean' ? parsed.allowAnsiblex : defaults.allowAnsiblex,
            ansiblexes: Array.isArray(parsed.ansiblexes) ? parsed.ansiblexes : defaults.ansiblexes,
          };
        }
      }
      const rawAX = localStorage.getItem('br.ansiblex.v1');
      if (rawAX) {
        const arr = JSON.parse(rawAX);
        if (Array.isArray(arr) && arr.length > 0) {
          return { ...defaults, ansiblexes: arr, allowAnsiblex: true };
        }
      }
    } catch {}
    return defaults;
  });
  const [planner, setPlanner] = useState<PlannerState>(() => {
    const defaults: PlannerState = {
      targetQuery: '',
      stagingQuery: '',
      bridgeRange: 6,
      routesToShow: 5,
      presetShipClass: 'Titan Bridge',
      presetJdc: 0,
    };
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            ...defaults,
            targetQuery: typeof parsed.targetQuery === 'string' ? parsed.targetQuery : defaults.targetQuery,
            stagingQuery: typeof parsed.stagingQuery === 'string' ? parsed.stagingQuery : defaults.stagingQuery,
            bridgeRange: Number.isFinite(parsed.bridgeRange) ? Number(parsed.bridgeRange) : defaults.bridgeRange,
            routesToShow: Number.isFinite(parsed.routesToShow) ? Math.max(1, Math.min(25, Number(parsed.routesToShow))) : defaults.routesToShow,
            presetShipClass: typeof parsed.presetShipClass === 'string' ? parsed.presetShipClass : defaults.presetShipClass,
            presetJdc: Number.isFinite(parsed.presetJdc) ? Math.max(0, Math.min(5, Number(parsed.presetJdc))) : defaults.presetJdc,
          };
        }
      }
    } catch {}
    return defaults;
  });
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
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
      localStorage.setItem('br.ansiblex.v1', JSON.stringify(settings.ansiblexes || []));
    } catch {}
  }, [settings.ansiblexes]);
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(planner));
    } catch {}
  }, [planner]);

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

  const destinationId = useMemo(() => (graph ? resolveQueryToId(planner.targetQuery, graph) : null), [graph, planner.targetQuery]);
  const stagingId = useMemo(() => (graph ? resolveQueryToId(planner.stagingQuery, graph) : null), [graph, planner.stagingQuery]);

  const [routeResult, setRouteResult] = useState<{ routes: RouteOption[]; message: string | null; loading: boolean; baselineJumps: number | null }>({
    routes: [],
    message: 'Enter a destination and staging system to calculate a route.',
    loading: false,
    baselineJumps: null,
  });
  const [copyStatus, setCopyStatus] = useState<null | 'success' | 'error'>(null);
  const [headerCopyOpen, setHeaderCopyOpen] = useState(false);
  const [routeCopyOpenKey, setRouteCopyOpenKey] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [userSelectedRoute, setUserSelectedRoute] = useState(false);

  useEffect(() => {
    if (!graph) return;
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../workers/bridgePlannerWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current.onmessage = (event: MessageEvent<{ type: 'partial' | 'result'; requestId: number; routes: RouteOption[]; message: string | null; baselineJumps: number | null }>) => {
        const data = event.data;
        if (data.requestId !== requestIdRef.current) return;
        if (data.type === 'partial') {
          setRouteResult((prev) => ({
            routes: data.routes,
            message: data.message ?? prev.message,
            loading: true,
            baselineJumps: data.baselineJumps ?? prev.baselineJumps,
          }));
          return;
        }
        setRouteResult({ routes: data.routes, message: data.message, loading: false, baselineJumps: data.baselineJumps ?? null });
      };
    }
    workerRef.current.postMessage({ type: 'init', graph: { systems: graph.systems } });
  }, [graph]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!graph || destinationId == null || stagingId == null) {
      setRouteResult({ routes: [], message: 'Enter a destination and staging system to calculate a route.', loading: false, baselineJumps: null });
      return;
    }
    if (!workerRef.current) return;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setUserSelectedRoute(false);
    setSelectedRouteKey(null);
    setRouteResult({ routes: [], message: 'Computing routes…', loading: true, baselineJumps: null });
    workerRef.current.postMessage({
      type: 'compute',
      requestId,
      destinationId,
      stagingId,
      bridgeRange: planner.bridgeRange,
      routesToShow: planner.routesToShow,
      settings: {
        excludeZarzakh: settings.excludeZarzakh,
        sameRegionOnly: settings.sameRegionOnly,
        bridgeIntoDestination: settings.bridgeIntoDestination,
        bridgeFromStaging: settings.bridgeFromStaging,
        bridgeCount: settings.bridgeCount,
        bridgeContinuous: settings.bridgeContinuous,
        allowAnsiblex: settings.allowAnsiblex,
        ansiblexes: settings.ansiblexes,
      },
    });
  }, [
    graph,
    destinationId,
    stagingId,
    planner.bridgeRange,
    planner.routesToShow,
    settings.excludeZarzakh,
    settings.sameRegionOnly,
    settings.bridgeIntoDestination,
    settings.bridgeFromStaging,
    settings.bridgeCount,
    settings.bridgeContinuous,
    settings.allowAnsiblex,
    settings.ansiblexes,
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

  const summary = useMemo(() => {
    if (!graph || !selectedRoute) return null;
    const parkingName = graph.namesById?.[String(selectedRoute.parkingId)] ?? String(selectedRoute.parkingId);
    const endpointName = graph.namesById?.[String(selectedRoute.bridgeEndpointId)] ?? String(selectedRoute.bridgeEndpointId);
    if (selectedRoute.parking2Id != null && selectedRoute.bridgeEndpoint2Id != null && selectedRoute.bridge2Ly != null) {
      const parking2Name = graph.namesById?.[String(selectedRoute.parking2Id)] ?? String(selectedRoute.parking2Id);
      const endpoint2Name = graph.namesById?.[String(selectedRoute.bridgeEndpoint2Id)] ?? String(selectedRoute.bridgeEndpoint2Id);
      const midTravel = selectedRoute.midTravelJumps ?? 0;
      return `${parkingName} | ${selectedRoute.travelJumps}j to park | bridge to ${endpointName} (${selectedRoute.bridgeLy.toFixed(2)} ly) | ${midTravel}j to ${parking2Name} | bridge to ${endpoint2Name} (${selectedRoute.bridge2Ly.toFixed(2)} ly) | ${selectedRoute.postBridgeJumps}j to destination | total ${selectedRoute.totalJumps}j`;
    }
    return `${parkingName} | ${selectedRoute.travelJumps}j to park | bridge to ${endpointName} (${selectedRoute.bridgeLy.toFixed(2)} ly) | ${selectedRoute.postBridgeJumps}j to destination | total ${selectedRoute.totalJumps}j`;
  }, [graph, selectedRoute]);

  const nameFor = (id: number | null) => {
    if (id == null) return '—';
    return graph?.namesById?.[String(id)] ?? String(id);
  };
  const stagingName = nameFor(stagingId);
  const destinationName = nameFor(destinationId);

  const routesForCopy = useMemo(() => routeResult.routes.slice(0, 10), [routeResult.routes]);
  const eveLinksMarkup = useMemo(() => {
    if (!graph || routesForCopy.length === 0) return '';
    const namesById = graph.namesById || {};
    const lines = routesForCopy.map((route) => {
      const parkingName = namesById[String(route.parkingId)] ?? String(route.parkingId);
      const endpointName = namesById[String(route.bridgeEndpointId)] ?? String(route.bridgeEndpointId);
      const parkingAnchor = `<a href="showinfo:5//${route.parkingId}">${parkingName}</a>`;
      const endpointAnchor = `<a href="showinfo:5//${route.bridgeEndpointId}">${endpointName}</a>`;
      let line = `${parkingAnchor} - ${endpointAnchor}`;
      if (route.parking2Id != null && route.bridgeEndpoint2Id != null) {
        const parking2Name = namesById[String(route.parking2Id)] ?? String(route.parking2Id);
        const endpoint2Name = namesById[String(route.bridgeEndpoint2Id)] ?? String(route.bridgeEndpoint2Id);
        const parking2Anchor = `<a href="showinfo:5//${route.parking2Id}">${parking2Name}</a>`;
        const endpoint2Anchor = `<a href="showinfo:5//${route.bridgeEndpoint2Id}">${endpoint2Name}</a>`;
        line += ` - ${parking2Anchor} - ${endpoint2Anchor}`;
      }
      return `${line} (${route.totalJumps}j)`;
    });
    const body = lines.join('<br>');
    return `<font size="13" color="#bfffffff"></font><font size="13" color="#ffffffff"><loc>${body}</loc></font>`;
  }, [graph, routesForCopy]);
  const plainTextRoutes = useMemo(() => {
    if (!graph || routesForCopy.length === 0) return '';
    const namesById = graph.namesById || {};
    const lines = routesForCopy.map((route) => {
      const parkingName = namesById[String(route.parkingId)] ?? String(route.parkingId);
      const endpointName = namesById[String(route.bridgeEndpointId)] ?? String(route.bridgeEndpointId);
      let line = `${parkingName} - ${endpointName}`;
      if (route.parking2Id != null && route.bridgeEndpoint2Id != null) {
        const parking2Name = namesById[String(route.parking2Id)] ?? String(route.parking2Id);
        const endpoint2Name = namesById[String(route.bridgeEndpoint2Id)] ?? String(route.bridgeEndpoint2Id);
        line += ` - ${parking2Name} - ${endpoint2Name}`;
      }
      return `${line} (${route.totalJumps}j)`;
    });
    return lines.join('\n');
  }, [graph, routesForCopy]);
  const buildRouteCopyPayload = useMemo(() => {
    if (!graph) return (_route: RouteOption) => ({ eve: '', plain: '' });
    const namesById = graph.namesById || {};
    return (route: RouteOption) => {
      const parkingName = namesById[String(route.parkingId)] ?? String(route.parkingId);
      const endpointName = namesById[String(route.bridgeEndpointId)] ?? String(route.bridgeEndpointId);
      let eveLine = `<a href="showinfo:5//${route.parkingId}">${parkingName}</a> - <a href="showinfo:5//${route.bridgeEndpointId}">${endpointName}</a>`;
      let plainLine = `${parkingName} - ${endpointName}`;
      if (route.parking2Id != null && route.bridgeEndpoint2Id != null) {
        const parking2Name = namesById[String(route.parking2Id)] ?? String(route.parking2Id);
        const endpoint2Name = namesById[String(route.bridgeEndpoint2Id)] ?? String(route.bridgeEndpoint2Id);
        eveLine += ` - <a href="showinfo:5//${route.parking2Id}">${parking2Name}</a> - <a href="showinfo:5//${route.bridgeEndpoint2Id}">${endpoint2Name}</a>`;
        plainLine += ` - ${parking2Name} - ${endpoint2Name}`;
      }
      eveLine += ` (${route.totalJumps}j)`;
      plainLine += ` (${route.totalJumps}j)`;
      const eve = `<font size="13" color="#bfffffff"></font><font size="13" color="#ffffffff"><loc>${eveLine}</loc></font>`;
      return { eve, plain: plainLine };
    };
  }, [graph]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus(null), 1200);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        setCopyStatus(ok ? 'success' : 'error');
        setTimeout(() => setCopyStatus(null), ok ? 1200 : 1800);
      } catch {
        setCopyStatus('error');
        setTimeout(() => setCopyStatus(null), 1800);
      }
    }
  }

  const fitNodeIds = useMemo(() => {
    if (routeResult.routes.length === 0) return [] as number[];
    const ids = new Set<number>();
    for (const route of routeResult.routes) {
      for (const id of route.travelPath) ids.add(id);
      for (const id of route.postBridgePath) ids.add(id);
      if (route.midTravelPath) {
        for (const id of route.midTravelPath) ids.add(id);
      }
      ids.add(route.parkingId);
      ids.add(route.bridgeEndpointId);
      if (route.parking2Id != null) ids.add(route.parking2Id);
      if (route.bridgeEndpoint2Id != null) ids.add(route.bridgeEndpoint2Id);
    }
    if (stagingId != null) ids.add(stagingId);
    if (destinationId != null) ids.add(destinationId);
    return Array.from(ids.values());
  }, [routeResult.routes, stagingId, destinationId]);

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
            <label className="grid gap-2">
            Starting system
              <AutocompleteInput
                graph={graph}
                value={planner.stagingQuery}
                onChange={(value) => setPlanner((prev) => ({ ...prev, stagingQuery: value }))}
                placeholder="e.g. UALX-3"
              />
            </label>

            <label className="grid gap-2">
              Destination system
              <AutocompleteInput
                graph={graph}
                value={planner.targetQuery}
                onChange={(value) => setPlanner((prev) => ({ ...prev, targetQuery: value }))}
                placeholder="e.g. C-J6MT"
              />
            </label>

            <label className="grid gap-2 md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <span>Bridge range: {planner.bridgeRange.toFixed(1)} ly</span>
                <div className="relative">
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
                                  setPlanner((prev) => ({ ...prev, presetShipClass: preset.label, bridgeRange: range }));
                                }}
                                className={
                                  "w-full text-left px-2 py-1 rounded border text-xs transition flex items-center gap-2 " +
                                  (isSelected
                                    ? "border-amber-400 bg-amber-50/80 dark:bg-amber-900/20 text-slate-900 dark:text-slate-100"
                                    : "border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 text-slate-700 dark:text-slate-300 hover:border-amber-300")
                                }
                                aria-pressed={isSelected}
                              >
                                <img
                                  src={`${base}ships/${shipIconByLabel[preset.label]}`}
                                  alt=""
                                  className="w-4 h-4"
                                />
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
                            const base = RANGE_PRESETS.find((p) => p.label === planner.presetShipClass)?.base ?? planner.bridgeRange;
                            const range = Number((base * (1 + 0.2 * jdc)).toFixed(1));
                            setPlanner((prev) => ({ ...prev, presetJdc: jdc, bridgeRange: range }));
                          }}
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
                type="range"
                className="accent-amber-600 w-full"
                min={1}
                max={10}
                step={0.5}
                value={planner.bridgeRange}
                onChange={(e) => setPlanner((prev) => ({ ...prev, bridgeRange: Number(e.target.value) }))}
              />
            </label>

            <fieldset className="md:col-span-2 border border-gray-200 dark:border-gray-700 rounded-md p-3">
              <legend className="px-1 text-sm text-gray-700 dark:text-gray-300">Travel graph</legend>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={!!settings.bridgeIntoDestination}
                    onChange={(e) => setSettings({
                      ...settings,
                      bridgeIntoDestination: e.target.checked,
                      bridgeFromStaging: e.target.checked ? false : settings.bridgeFromStaging,
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
                      bridgeIntoDestination: e.target.checked ? false : settings.bridgeIntoDestination,
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
                      });
                    }}
                  >
                    {[1, 2].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                {settings.bridgeCount === 2 && (
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
                <div className="relative">
                  {copyStatus && (
                    <div className={"pointer-events-none absolute -top-8 right-0 px-3 py-1.5 rounded shadow text-xs inline-flex items-center gap-2 " + (copyStatus === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white')} role="status" aria-live="polite">
                      <Icon name={copyStatus === 'success' ? 'copy' : 'warn'} size={12} color="white" />
                      {copyStatus === 'success' ? 'Copied!' : 'Copy failed'}
                    </div>
                  )}
                  <div
                    className="relative"
                    onMouseLeave={() => setHeaderCopyOpen(false)}
                  >
                    <button
                      type="button"
                      className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"
                      disabled={!eveLinksMarkup && !plainTextRoutes}
                      aria-label="Copy"
                      onMouseEnter={() => setHeaderCopyOpen(true)}
                    >
                      <Icon name="copy" size={14} />
                      <span>Copy</span>
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
                              if (eveLinksMarkup) copyText(eveLinksMarkup);
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                            disabled={!eveLinksMarkup}
                          >
                            Copy EVE in-game links
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (plainTextRoutes) copyText(plainTextRoutes);
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

                  const parkingName = nameFor(route.parkingId);
                  const endpointName = nameFor(route.bridgeEndpointId);
                  const parking2Name = route.parking2Id != null ? nameFor(route.parking2Id) : null;
                  const endpoint2Name = route.bridgeEndpoint2Id != null ? nameFor(route.bridgeEndpoint2Id) : null;
                  const isSelected = selectedRoute?.key === route.key;
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
                      <div className="w-full text-left pointer-events-none">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {stagingName} → {parkingName} → {endpointName}
                          {parking2Name && endpoint2Name ? ` → ${parking2Name} → ${endpoint2Name}` : ''} → {destinationName}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                          <span>
                            {route.travelJumps}j to park • {route.bridgeLy.toFixed(2)} ly bridge
                            {route.parking2Id != null && route.bridge2Ly != null ? ` • ${route.midTravelJumps ?? 0}j to park 2 • ${route.bridge2Ly.toFixed(2)} ly bridge` : ''}
                            {' '}• {route.postBridgeJumps}j after
                          </span>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{route.totalJumps}j</span>
                        </div>
                      </div>
                      <div className="absolute top-2 right-2 flex items-center gap-2">
                        {idx === 0 && (
                          <span className="text-[10px] uppercase tracking-wide rounded-full bg-amber-200 text-amber-900 px-2 py-0.5">
                            Best
                          </span>
                        )}
                        <div className="relative pointer-events-auto" onClick={(event) => event.stopPropagation()}>
                          {copyStatus && (
                            <div className={"pointer-events-none absolute -top-8 right-0 px-3 py-1.5 rounded shadow text-xs inline-flex items-center gap-2 " + (copyStatus === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white')} role="status" aria-live="polite">
                              <Icon name={copyStatus === 'success' ? 'copy' : 'warn'} size={12} color="white" />
                              {copyStatus === 'success' ? 'Copied!' : 'Copy failed'}
                            </div>
                          )}
                          <div
                            className="relative"
                            onMouseLeave={() => setRouteCopyOpenKey(null)}
                          >
                            <button
                              type="button"
                              className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"
                              aria-label="Copy"
                              onMouseEnter={() => setRouteCopyOpenKey(route.key)}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Icon name="copy" size={14} />
                              <span>Copy</span>
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
                                      if (payload.eve) copyText(payload.eve);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                                  >
                                    Copy EVE in-game links
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const payload = buildRouteCopyPayload(route);
                                      if (payload.plain) copyText(payload.plain);
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
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <BridgePlannerMap
          graph={graph}
          namesById={graph?.namesById || {}}
          stagingId={stagingId}
          destinationId={destinationId}
          parkingId={selectedRoute?.parkingId ?? null}
          bridgeEndpointId={selectedRoute?.bridgeEndpointId ?? null}
          parking2Id={selectedRoute?.parking2Id ?? null}
          bridgeEndpoint2Id={selectedRoute?.bridgeEndpoint2Id ?? null}
          travelPath={selectedRoute?.travelPath ?? null}
          midTravelPath={selectedRoute?.midTravelPath ?? null}
          postBridgePath={selectedRoute?.postBridgePath ?? null}
          fitNodeIds={fitNodeIds}
          bridgeRange={planner.bridgeRange}
          settings={{ allowAnsiblex: settings.allowAnsiblex, ansiblexes: settings.ansiblexes }}
          statusMessage={routeResult.message}
          summary={summary}
          baselineJumps={routeResult.baselineJumps}
        />
      </div>

      {showAnsiblexModal && (
        <SharedAnsiblexModal
          onClose={() => setShowAnsiblexModal(false)}
          value={settings.ansiblexes || []}
          onChange={(list) => setSettings(s => ({ ...s, ansiblexes: list }))}
        />
      )}
    </section>
  );
}
