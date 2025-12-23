import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { Icon } from '../components/Icon';
import { AnsiblexModal as SharedAnsiblexModal } from '../components/AnsiblexModal';
import { BridgePlannerMap } from '../components/BridgePlannerMap';

//const LY = 9.4607e15;

type PlannerState = {
  targetQuery: string;
  stagingQuery: string;
  bridgeRange: number;
  routesToShow: number;
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
};

export function BridgePlanner() {
  const UI_KEY = 'br.bridgePlanner.ui.v1';
  const SETTINGS_STORAGE_KEY = 'br.settings.v1';

  const [graph, setGraph] = useState<GraphData | null>(() => (window as any).appGraph || null);
  const [showAnsiblexModal, setShowAnsiblexModal] = useState(false);
  const [settings, setSettings] = useState<{ excludeZarzakh: boolean; sameRegionOnly: boolean; titanBridgeFirstJump: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }> }>(() => {
    const defaults = { excludeZarzakh: true, sameRegionOnly: false, titanBridgeFirstJump: false, allowAnsiblex: false, ansiblexes: [] as Array<{ from: number; to: number; enabled?: boolean }> };
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
          };
        }
      }
    } catch {}
    return defaults;
  });

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

  const destinationId = useMemo(() => (graph ? resolveQueryToId(planner.targetQuery, graph) : null), [graph, planner.targetQuery]);
  const stagingId = useMemo(() => (graph ? resolveQueryToId(planner.stagingQuery, graph) : null), [graph, planner.stagingQuery]);

  const [routeResult, setRouteResult] = useState<{ routes: RouteOption[]; message: string | null; loading: boolean; baselineJumps: number | null }>({
    routes: [],
    message: 'Enter a destination and staging system to calculate a route.',
    loading: false,
    baselineJumps: null,
  });
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
    return `${parkingName} | ${selectedRoute.travelJumps}j to park | bridge to ${endpointName} (${selectedRoute.bridgeLy.toFixed(2)} ly) | ${selectedRoute.postBridgeJumps}j to destination | total ${selectedRoute.totalJumps}j`;
  }, [graph, selectedRoute]);

  const nameFor = (id: number | null) => {
    if (id == null) return '—';
    return graph?.namesById?.[String(id)] ?? String(id);
  };
  const stagingName = nameFor(stagingId);
  const destinationName = nameFor(destinationId);

  const fitNodeIds = useMemo(() => {
    if (routeResult.routes.length === 0) return [] as number[];
    const ids = new Set<number>();
    for (const route of routeResult.routes) {
      for (const id of route.travelPath) ids.add(id);
      for (const id of route.postBridgePath) ids.add(id);
      ids.add(route.parkingId);
      ids.add(route.bridgeEndpointId);
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
              Titan bridge range: {planner.bridgeRange.toFixed(1)} ly
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
                  const isSelected = selectedRoute?.key === route.key;
                  return (
                    <button
                      key={route.key}
                      type="button"
                      onClick={() => {
                        setSelectedRouteKey(route.key);
                        setUserSelectedRoute(true);
                      }}
                      className={
                        "relative w-full text-left rounded-lg border px-4 py-3 transition " +
                        (isSelected
                          ? "border-amber-400 bg-amber-50/80 dark:bg-amber-900/20 shadow-sm"
                          : "border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-gray-900/40 hover:border-amber-300")
                      }
                    >
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {stagingName} → {parkingName} → {endpointName} → {destinationName}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                        <span>{route.travelJumps}j to park • {route.bridgeLy.toFixed(2)} ly bridge • {route.postBridgeJumps}j after</span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{route.totalJumps}j</span>
                      </div>
                      {idx === 0 && (
                        <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wide rounded-full bg-amber-200 text-amber-900 px-2 py-0.5">
                          Best
                        </span>
                      )}
                    </button>
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
          travelPath={selectedRoute?.travelPath ?? null}
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
