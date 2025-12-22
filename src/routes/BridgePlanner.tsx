import { useEffect, useMemo, useState } from 'react';
import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { Icon } from '../components/Icon';
import { AnsiblexModal as SharedAnsiblexModal } from '../components/AnsiblexModal';
import { BridgePlannerMap } from '../components/BridgePlannerMap';

const LY = 9.4607e15;
const MAX_TRAVEL_JUMPS = 200;

type TravelSettings = {
  excludeZarzakh?: boolean;
  sameRegionOnly?: boolean;
  allowAnsiblex?: boolean;
  ansiblexes?: Array<{ from: number; to: number; enabled?: boolean; bidirectional?: boolean }>;
};

function computeTravelTree({ graph, startId, settings, maxJumps }: { graph: GraphData; startId: number; settings: TravelSettings; maxJumps: number }) {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: number[] = [];
  const systems = graph.systems;
  const start = systems[String(startId)];
  if (!start) return { dist, prev };

  const exclude = new Set<number>();
  if (settings.excludeZarzakh) exclude.add(30100000);
  const sameRegionOnly = !!settings.sameRegionOnly;
  const startRegion = start.regionId;

  const ansiFrom: Map<number, number[]> = new Map();
  if (settings.allowAnsiblex && settings.ansiblexes?.length) {
    for (const b of settings.ansiblexes) {
      if (!b || b.enabled === false) continue;
      const from = Number(b.from);
      const to = Number(b.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      if (!ansiFrom.has(from)) ansiFrom.set(from, []);
      ansiFrom.get(from)!.push(to);
      if (b.bidirectional !== false) {
        if (!ansiFrom.has(to)) ansiFrom.set(to, []);
        ansiFrom.get(to)!.push(from);
      }
    }
  }

  dist.set(startId, 0);
  queue.push(startId);

  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const d = dist.get(id);
    if (d == null) continue;
    if (d >= maxJumps) continue;
    const node = systems[String(id)];
    if (!node) continue;
    if (exclude.has(id)) continue;
    if (sameRegionOnly && node.regionId !== startRegion) continue;

    for (const next of node.adjacentSystems) {
      if (exclude.has(next)) continue;
      const nextNode = systems[String(next)];
      if (!nextNode) continue;
      if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        prev.set(next, id);
        queue.push(next);
      }
    }

    if (settings.allowAnsiblex) {
      const outs = ansiFrom.get(id) || [];
      for (const next of outs) {
        if (exclude.has(next)) continue;
        const nextNode = systems[String(next)];
        if (!nextNode) continue;
        if (sameRegionOnly && nextNode.regionId !== startRegion) continue;
        if (!dist.has(next)) {
          dist.set(next, d + 1);
          prev.set(next, id);
          queue.push(next);
        }
      }
    }
  }

  return { dist, prev };
}

function buildPath(prev: Map<number, number>, startId: number, endId: number): number[] | null {
  const path: number[] = [];
  let cur: number | undefined = endId;
  while (cur != null) {
    path.push(cur);
    if (cur === startId) break;
    cur = prev.get(cur);
    if (cur == null) return null;
  }
  return path.reverse();
}

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

  const routeResult = useMemo(() => {
    if (!graph || destinationId == null || stagingId == null) {
      return { routes: [] as RouteOption[], message: 'Enter a destination and staging system to calculate a route.' };
    }

    if (!graph.systems[String(destinationId)]) {
      return { routes: [] as RouteOption[], message: 'Destination system not found.' };
    }

    if (!graph.systems[String(stagingId)]) {
      return { routes: [] as RouteOption[], message: 'Staging system not found.' };
    }

    const maxMeters = planner.bridgeRange * LY;
    const maxMetersSq = maxMeters * maxMeters;

    const systemsList: Array<{ id: number; x: number; y: number; z: number }> = [];
    for (const [idStr, sys] of Object.entries(graph.systems)) {
      const id = Number(idStr);
      if (!Number.isFinite(id)) continue;
      systemsList.push({ id, x: sys.position.x, y: sys.position.y, z: sys.position.z });
    }

    const { dist: stagingDist, prev: stagingPrev } = computeTravelTree({
      graph,
      startId: stagingId,
      settings: {
        excludeZarzakh: settings.excludeZarzakh,
        sameRegionOnly: settings.sameRegionOnly,
        allowAnsiblex: settings.allowAnsiblex,
        ansiblexes: settings.ansiblexes,
      },
      maxJumps: MAX_TRAVEL_JUMPS,
    });

    const { dist: destinationDist, prev: destinationPrev } = computeTravelTree({
      graph,
      startId: destinationId,
      settings: {
        excludeZarzakh: settings.excludeZarzakh,
        sameRegionOnly: settings.sameRegionOnly,
        allowAnsiblex: settings.allowAnsiblex,
        ansiblexes: settings.ansiblexes,
      },
      maxJumps: MAX_TRAVEL_JUMPS,
    });

    const endpointList: Array<{ id: number; x: number; y: number; z: number; jumps: number }> = [];
    for (const sys of systemsList) {
      const jumps = destinationDist.get(sys.id);
      if (jumps == null) continue;
      endpointList.push({ ...sys, jumps });
    }

    if (endpointList.length === 0) {
      return { routes: [] as RouteOption[], message: 'No destination routes found.' };
    }

    const candidates: Array<{ parkingId: number; endpointId: number; stagingJumps: number; destinationJumps: number; bridgeMeters: number; totalJumps: number }> = [];
    for (const parking of systemsList) {
      if (settings.excludeZarzakh && parking.id === 30100000) continue;
      const stagingJumps = stagingDist.get(parking.id);
      if (stagingJumps == null) continue;
      let bestEndpoint: { id: number; jumps: number; bridgeMeters: number } | null = null;
      for (const endpoint of endpointList) {
        const dx = parking.x - endpoint.x;
        const dy = parking.y - endpoint.y;
        const dz = parking.z - endpoint.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxMetersSq) continue;
        const bridgeMeters = Math.sqrt(d2);
        if (
          !bestEndpoint ||
          endpoint.jumps < bestEndpoint.jumps ||
          (endpoint.jumps === bestEndpoint.jumps && bridgeMeters < bestEndpoint.bridgeMeters)
        ) {
          bestEndpoint = { id: endpoint.id, jumps: endpoint.jumps, bridgeMeters };
        }
      }
      if (!bestEndpoint) continue;
      const totalJumps = stagingJumps + bestEndpoint.jumps;
      candidates.push({
        parkingId: parking.id,
        endpointId: bestEndpoint.id,
        stagingJumps,
        destinationJumps: bestEndpoint.jumps,
        bridgeMeters: bestEndpoint.bridgeMeters,
        totalJumps,
      });
    }

    if (candidates.length === 0) {
      return { routes: [] as RouteOption[], message: 'No reachable parking systems found.' };
    }

    candidates.sort((a, b) => {
      if (a.totalJumps !== b.totalJumps) return a.totalJumps - b.totalJumps;
      if (a.stagingJumps !== b.stagingJumps) return a.stagingJumps - b.stagingJumps;
      if (a.destinationJumps !== b.destinationJumps) return a.destinationJumps - b.destinationJumps;
      return a.bridgeMeters - b.bridgeMeters;
    });

    const routes: RouteOption[] = [];
    const limit = Math.max(1, Math.min(25, planner.routesToShow || 5));
    for (const c of candidates.slice(0, limit)) {
      const travelPath = buildPath(stagingPrev, stagingId, c.parkingId);
      const destinationPath = buildPath(destinationPrev, destinationId, c.endpointId);
      if (!travelPath || !destinationPath) continue;
      routes.push({
        key: `${c.parkingId}-${c.endpointId}`,
        travelPath,
        postBridgePath: destinationPath.slice().reverse(),
        parkingId: c.parkingId,
        bridgeEndpointId: c.endpointId,
        travelJumps: c.stagingJumps,
        postBridgeJumps: c.destinationJumps,
        totalJumps: c.totalJumps,
        bridgeLy: c.bridgeMeters / LY,
      });
    }

    if (routes.length === 0) {
      return { routes: [] as RouteOption[], message: 'No routes found.' };
    }

    return { routes, message: null as string | null };
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
              Starting system (staging)
              <AutocompleteInput
                graph={graph}
                value={planner.stagingQuery}
                onChange={(value) => setPlanner((prev) => ({ ...prev, stagingQuery: value }))}
                placeholder="e.g. Jita"
              />
            </label>

            <label className="grid gap-2">
              Destination system
              <AutocompleteInput
                graph={graph}
                value={planner.targetQuery}
                onChange={(value) => setPlanner((prev) => ({ ...prev, targetQuery: value }))}
                placeholder="e.g. 1DQ1-A"
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
              <h2 className="text-lg font-semibold">Routes</h2>
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
            {routeResult.routes.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{routeResult.message || 'No routes available.'}</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {routeResult.routes.map((route, idx) => {
                  const parkingName = nameFor(route.parkingId);
                  const endpointName = nameFor(route.bridgeEndpointId);
                  const isSelected = selectedRoute?.key === route.key;
                  return (
                    <button
                      key={route.key}
                      type="button"
                      onClick={() => setSelectedRouteKey(route.key)}
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
