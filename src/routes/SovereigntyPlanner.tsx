import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutocompleteInput,
  type AutocompleteItem,
} from '../components/AutocompleteInput';
import { ModalShell } from '../components/ModalShell';
import { SovereigntyPlannerMap } from '../components/SovereigntyPlannerMap';
import type { GraphData } from '../lib/data';
import { loadSovereigntyHolders, type SovereigntyHolder } from '../lib/sovereignty';

type AppWindow = Window & {
  appGraph?: GraphData;
};

const SOVEREIGNTY_UI_STORAGE_KEY = 'br.sovereigntyPlanner.ui.v1';

function loadStoredSystemIds() {
  if (typeof window === 'undefined') return new Set<number>();
  try {
    const raw = localStorage.getItem(SOVEREIGNTY_UI_STORAGE_KEY);
    if (!raw) return new Set<number>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.selectedSystemIds)) return new Set<number>();
    return new Set<number>(
      parsed.selectedSystemIds
        .map(Number)
        .filter((id: number) => Number.isInteger(id) && id > 0),
    );
  } catch {
    return new Set<number>();
  }
}

export function SovereigntyPlanner() {
  const [graph, setGraph] = useState<GraphData | null>(() => (
    (window as AppWindow).appGraph ?? null
  ));
  const storedSystemIdsRef = useRef(loadStoredSystemIds());
  const hasValidatedStoredSelectionRef = useRef(false);
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<number>>(
    () => new Set(storedSystemIdsRef.current),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [territoryEditing, setTerritoryEditing] = useState(false);
  const [showClearConfirmation, setShowClearConfirmation] = useState(false);
  const [fitSelectionRequest, setFitSelectionRequest] = useState(0);
  const [sovereigntyHolders, setSovereigntyHolders] = useState<SovereigntyHolder[]>([]);
  const [holderStatus, setHolderStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    const syncGraph = () => {
      const loadedGraph = (window as AppWindow).appGraph;
      if (loadedGraph) setGraph(loadedGraph);
    };
    syncGraph();
    window.addEventListener('graph-loaded', syncGraph);
    return () => window.removeEventListener('graph-loaded', syncGraph);
  }, []);

  const eligibleSystemIds = useMemo(() => {
    const ids = new Set<number>();
    if (!graph) return ids;
    for (const system of Object.values(graph.systems)) {
      if (system.isSovereigntyEligible) ids.add(system.systemId);
    }
    return ids;
  }, [graph]);

  useEffect(() => {
    if (!graph || hasValidatedStoredSelectionRef.current) return;
    hasValidatedStoredSelectionRef.current = true;
    const validated = new Set(
      Array.from(storedSystemIdsRef.current).filter((id) => eligibleSystemIds.has(id)),
    );
    setSelectedSystemIds(validated);
    if (validated.size > 0) {
      setFitSelectionRequest((request) => request + 1);
    } else {
      setTerritoryEditing(true);
    }
  }, [eligibleSystemIds, graph]);

  useEffect(() => {
    try {
      localStorage.setItem(SOVEREIGNTY_UI_STORAGE_KEY, JSON.stringify({
        selectedSystemIds: Array.from(selectedSystemIds).sort((a, b) => a - b),
      }));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }, [selectedSystemIds]);

  useEffect(() => {
    if (!graph || eligibleSystemIds.size === 0) return;
    const controller = new AbortController();
    setHolderStatus('loading');
    loadSovereigntyHolders(eligibleSystemIds, controller.signal)
      .then((holders) => {
        setSovereigntyHolders(holders);
        setHolderStatus('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSovereigntyHolders([]);
        setHolderStatus('error');
      });
    return () => controller.abort();
  }, [eligibleSystemIds, graph]);

  const selectionIndex = useMemo(() => {
    const items: AutocompleteItem[] = [];
    const systemIdsByKey = new Map<string, number[]>();
    if (!graph) return { items, systemIdsByKey };

    const eligibleByConstellation = new Map<number, number[]>();
    const eligibleByRegion = new Map<number, number[]>();
    for (const id of eligibleSystemIds) {
      const system = graph.systems[String(id)];
      if (!system) continue;
      const name = graph.namesById?.[String(id)] ?? String(id);
      const regionName = graph.regionsById?.[String(system.regionId)] ?? String(system.regionId);
      items.push({
        id,
        name,
        kind: 'system',
        regionName,
        meta: regionName,
      });
      systemIdsByKey.set(`system:${id}`, [id]);

      const constellationSystems = eligibleByConstellation.get(system.constellationId) ?? [];
      constellationSystems.push(id);
      eligibleByConstellation.set(system.constellationId, constellationSystems);

      const regionSystems = eligibleByRegion.get(system.regionId) ?? [];
      regionSystems.push(id);
      eligibleByRegion.set(system.regionId, regionSystems);
    }

    for (const [constellationId, systemIds] of eligibleByConstellation) {
      const firstSystem = graph.systems[String(systemIds[0])];
      const regionName = firstSystem
        ? graph.regionsById?.[String(firstSystem.regionId)] ?? String(firstSystem.regionId)
        : '';
      items.push({
        id: constellationId,
        name: graph.constellationsById?.[String(constellationId)] ?? String(constellationId),
        kind: 'constellation',
        regionName,
        meta: `${systemIds.length} systems · ${regionName}`,
      });
      systemIdsByKey.set(`constellation:${constellationId}`, systemIds);
    }

    for (const [regionId, systemIds] of eligibleByRegion) {
      items.push({
        id: regionId,
        name: graph.regionsById?.[String(regionId)] ?? String(regionId),
        kind: 'region',
        meta: `${systemIds.length} systems`,
      });
      systemIdsByKey.set(`region:${regionId}`, systemIds);
    }

    for (const holder of sovereigntyHolders) {
      const systemIds = holder.systemIds.filter((id) => eligibleSystemIds.has(id));
      if (systemIds.length === 0) continue;
      items.push({
        id: holder.id,
        name: holder.name,
        kind: holder.kind,
        meta: holder.kind === 'corporation'
          ? `${systemIds.length} alliance systems`
          : `${systemIds.length} systems`,
      });
      systemIdsByKey.set(`${holder.kind}:${holder.id}`, systemIds);
    }

    return { items, systemIdsByKey };
  }, [eligibleSystemIds, graph, sovereigntyHolders]);

  const holdingAllianceIdsBySystemId = useMemo(() => {
    const allianceIdsBySystemId = new Map<number, number>();
    for (const holder of sovereigntyHolders) {
      if (holder.kind !== 'alliance') continue;
      for (const systemId of holder.systemIds) {
        allianceIdsBySystemId.set(systemId, holder.id);
      }
    }
    return allianceIdsBySystemId;
  }, [sovereigntyHolders]);

  const toggleSystem = useCallback((systemId: number) => {
    if (!territoryEditing || !eligibleSystemIds.has(systemId)) return;
    setSelectedSystemIds((current) => {
      const next = new Set(current);
      if (next.has(systemId)) next.delete(systemId);
      else next.add(systemId);
      return next;
    });
  }, [eligibleSystemIds, territoryEditing]);

  const applySmartGroupToggle = useCallback((systemIds: readonly number[], requestFit: boolean) => {
    const eligibleIds = systemIds.filter((id) => eligibleSystemIds.has(id));
    if (eligibleIds.length === 0) return;
    setSelectedSystemIds((current) => {
      const next = new Set(current);
      const removeGroup = eligibleIds.every((id) => current.has(id));
      for (const id of eligibleIds) {
        if (removeGroup) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    if (requestFit) setFitSelectionRequest((request) => request + 1);
  }, [eligibleSystemIds]);

  const handleAutocompleteSelect = useCallback((item: AutocompleteItem) => {
    if (!item.kind) return;
    const systemIds = selectionIndex.systemIdsByKey.get(`${item.kind}:${item.id}`) ?? [];
    applySmartGroupToggle(systemIds, true);
    setSearchQuery('');
  }, [applySmartGroupToggle, selectionIndex.systemIdsByKey]);

  const handleLassoSelection = useCallback((systemIds: number[]) => {
    if (!territoryEditing) return;
    const eligibleIds = systemIds.filter((id) => eligibleSystemIds.has(id));
    if (eligibleIds.length === 0) return;
    setSelectedSystemIds((current) => {
      const next = new Set(current);
      const removeGroup = eligibleIds.every((id) => current.has(id));
      for (const id of eligibleIds) {
        if (removeGroup) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [eligibleSystemIds, territoryEditing]);

  const confirmClearSelection = useCallback(() => {
    setSelectedSystemIds(new Set());
    setFitSelectionRequest((request) => request + 1);
    setShowClearConfirmation(false);
  }, []);

  const enterTerritoryEditor = useCallback(() => {
    setTerritoryEditing(true);
  }, []);

  const exitTerritoryEditor = useCallback(() => {
    setTerritoryEditing(false);
    setSearchQuery('');
    setShowClearConfirmation(false);
  }, []);

  return (
    <>
      <div className="grid min-h-[540px] flex-1 gap-4 md:grid-cols-[18rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside
          className="flex min-h-32 flex-col gap-4 rounded-lg border border-gray-200 bg-white/50 p-4 dark:border-gray-700 dark:bg-black/20 md:min-h-0"
          aria-label="Sovereignty planner toolbar"
        >
          {territoryEditing ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Territory
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Select the space you want to manage
                  </div>
                </div>
                <button
                  type="button"
                  onClick={exitTerritoryEditor}
                  className="shrink-0 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
                >
                  Done
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Add territory
                </label>
                <AutocompleteInput
                  compact
                  graph={graph}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onSelect={handleAutocompleteSelect}
                  items={selectionIndex.items}
                  placeholder="System, region, alliance…"
                />
                {holderStatus === 'loading' && (
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Loading live sovereignty holders…
                  </p>
                )}
                {holderStatus === 'error' && (
                  <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    Live alliance and corporation search is unavailable.
                  </p>
                )}
              </div>

              <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400">Selected territory</div>
                <div className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {selectedSystemIds.size.toLocaleString()} systems
                </div>
              </div>

              <div className="rounded-md bg-slate-100 px-3 py-2 text-xs leading-4 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                Hold Alt or Option and drag on the map to lasso systems.
              </div>

              <button
                type="button"
                onClick={() => setShowClearConfirmation(true)}
                disabled={selectedSystemIds.size === 0}
                className="mt-auto rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                Clear all territory
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={enterTerritoryEditor}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/60"
              aria-label={`Edit territory. ${selectedSystemIds.size.toLocaleString()} systems selected.`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                  Territory
                </span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                  {selectedSystemIds.size > 0
                    ? `${selectedSystemIds.size.toLocaleString()} systems`
                    : 'No systems selected'}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-purple-700 dark:text-purple-400">
                Edit
              </span>
            </button>
          )}
        </aside>
        <SovereigntyPlannerMap
          graph={graph}
          selectedSystemIds={selectedSystemIds}
          holdingAllianceIdsBySystemId={holdingAllianceIdsBySystemId}
          onToggleSystem={toggleSystem}
          territoryEditing={territoryEditing}
          onLassoSelection={handleLassoSelection}
          fitSelectionRequest={fitSelectionRequest}
        />
      </div>

      <ModalShell
        open={showClearConfirmation}
        onClose={() => setShowClearConfirmation(false)}
        position="center"
        panelClassName="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        labelledBy="clear-territory-title"
      >
        <h2 id="clear-territory-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Clear all territory?
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          This will remove all {selectedSystemIds.size.toLocaleString()} selected systems from the planner.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowClearConfirmation(false)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmClearSelection}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Clear territory
          </button>
        </div>
      </ModalShell>
    </>
  );
}
