import type { Dispatch, SetStateAction } from 'react';
import type { CopyStatus } from '../lib/copy';
import { getCopyButtonClass, getCopyButtonIconColor, getCopyButtonIconName, getCopyButtonLabel } from '../lib/copy';
import type { GraphData } from '../lib/data';
import { AutocompleteInput } from './AutocompleteInput';
import { Icon } from './Icon';
import SegmentedSlider from './SegmentedSlider';

export type WormholeType = 'Conflux' | 'Barbican' | 'Redoubt' | 'Sentinel' | 'Vidette';
export type EolLevel = 'lt1d' | 'lt4h' | 'lt1h';
export type MassLevel = 'gt50' | 'lt50' | 'lt10';

export type ScannerWormhole = {
  id: string;
  systemId: number | null;
  systemName: string;
  type: WormholeType | null;
  eol: EolLevel | null;
  mass: MassLevel;
  bookmarkInside: boolean;
  bookmarkOutside: boolean;
};

export type ScannerSettings = {
  excludeZarzakh: boolean;
  sameRegionOnly: boolean;
  titanBridgeFirstJump: boolean;
  allowAnsiblex?: boolean;
  ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }>;
  blacklistEnabled?: boolean;
  blacklist?: Array<{ id: number; enabled?: boolean }>;
};

export type ScannerWormholeRoute = {
  id: string;
  type: WormholeType;
  fromWh: ScannerWormhole;
  toWh: ScannerWormhole;
  fromJumps: number;
  toJumps: number;
  total: number;
};

const wormholeTypeOptions = (['Conflux', 'Barbican', 'Redoubt', 'Sentinel', 'Vidette'] as WormholeType[])
  .map((type) => ({ label: type[0], value: type }));

const eolOptions = [
  { label: '1d', value: 'lt1d' },
  { label: '4h', value: 'lt4h' },
  { label: '1h', value: 'lt1h' },
];

const massOptions = [
  { label: '>50%', value: 'gt50' },
  { label: '<50%', value: 'lt50' },
  { label: '<10%', value: 'lt10' },
];

function normalizeSystemName(value: string) {
  return value.toUpperCase().replace(/[-\s]/g, '');
}

function hasObservatory(graph: GraphData | null, id: number) {
  try {
    return !!graph?.systems[String(id)]?.hasObservatory;
  } catch {
    return false;
  }
}

function wormholeTypeColor(value: string) {
  if (value === 'Conflux') return 'bg-blue-600';
  if (value === 'Barbican') return 'bg-amber-500';
  if (value === 'Redoubt') return 'bg-gray-500';
  if (value === 'Sentinel') return 'bg-purple-500';
  if (value === 'Vidette') return 'bg-teal-500';
  return 'bg-gray-600';
}

function eolColor(value: string) {
  if (value === 'lt1h') return 'bg-red-500';
  if (value === 'lt4h') return 'bg-amber-500';
  if (value === 'lt1d') return 'bg-blue-600';
  return 'bg-gray-500';
}

function massColor(value: string) {
  if (value === 'lt10') return 'bg-red-500';
  if (value === 'lt50') return 'bg-amber-500';
  if (value === 'gt50') return 'bg-blue-600';
  return 'bg-gray-500';
}

function typePillClass(type: WormholeType | null) {
  const base = 'px-3 sm:px-4 py-1 sm:py-1.5 rounded-md border text-sm sm:text-base font-semibold shadow-sm ';
  if (type === 'Conflux') return base + 'bg-blue-600/10 border-blue-500/60 text-blue-700 dark:text-blue-300';
  if (type === 'Barbican') return base + 'bg-amber-500/10 border-amber-500/60 text-amber-700 dark:text-amber-300';
  if (type === 'Redoubt') return base + 'bg-gray-500/10 border-gray-500/60 text-gray-700 dark:text-gray-300';
  if (type === 'Sentinel') return base + 'bg-purple-500/10 border-purple-500/60 text-purple-700 dark:text-purple-300';
  if (type === 'Vidette') return base + 'bg-teal-500/10 border-teal-500/60 text-teal-700 dark:text-teal-300';
  return base + 'bg-gray-500/10 border-gray-400/60 text-slate-800 dark:text-slate-100';
}

function getWhWarning(wormhole: ScannerWormhole | null | undefined): { color: string; title: string } | null {
  if (!wormhole) return null;
  const redLabels: string[] = [];
  const amberLabels: string[] = [];
  if (wormhole.mass === 'lt10') redLabels.push('Mass <10%');
  else if (wormhole.mass === 'lt50') amberLabels.push('Mass <50%');
  if (wormhole.eol === 'lt1h') redLabels.push('Life <1h');
  else if (wormhole.eol === 'lt4h') amberLabels.push('Life <4h');
  const labels = [...redLabels, ...amberLabels];
  if (labels.length === 0) return null;
  return { color: redLabels.length > 0 ? '#ef4444' : '#f59e0b', title: labels.join(' + ') };
}

function systemLabel(graph: GraphData | null, id: number | null, fallback: string | number | null | undefined) {
  if (id != null) return graph?.namesById?.[String(id)] ?? String(fallback ?? id);
  return String(fallback ?? '-');
}

export function ScannerSetupPanel({
  graph,
  route,
  settings,
  onRouteChange,
  onSettingsChange,
  onConfigureAnsiblex,
  onClearSettings,
}: {
  graph: GraphData | null;
  route: { fromQuery: string; toQuery: string };
  settings: ScannerSettings;
  onRouteChange: Dispatch<SetStateAction<{ fromQuery: string; toQuery: string }>>;
  onSettingsChange: Dispatch<SetStateAction<ScannerSettings>>;
  onConfigureAnsiblex: () => void;
  onClearSettings: () => void;
}) {
  return (
    <section className="grid gap-4 grid-cols-1 md:grid-cols-2 bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <label className="grid gap-2">
        Start system (name):
        <AutocompleteInput graph={graph} value={route.fromQuery} onChange={(value) => onRouteChange((prev) => ({ ...prev, fromQuery: value }))} placeholder="e.g. Jita" />
      </label>
      <label className="grid gap-2">
        Destination system (name):
        <AutocompleteInput graph={graph} value={route.toQuery} onChange={(value) => onRouteChange((prev) => ({ ...prev, toQuery: value }))} placeholder="e.g. Amarr" />
      </label>
      <fieldset className="md:col-span-2 border border-gray-200 dark:border-gray-700 rounded-md p-3">
        <legend className="px-1 text-sm text-gray-700 dark:text-gray-300">Settings</legend>
        <label className="inline-flex items-center gap-2 mr-4">
          <input type="checkbox" className="accent-blue-600" checked={settings.excludeZarzakh} onChange={(event) => onSettingsChange({ ...settings, excludeZarzakh: event.target.checked })} />
          <span>Exclude Zarzakh</span>
        </label>
        <label className="inline-flex items-center gap-2 mr-4">
          <input type="checkbox" className="accent-purple-600" checked={settings.titanBridgeFirstJump} onChange={(event) => onSettingsChange({ ...settings, titanBridgeFirstJump: event.target.checked })} />
          <span>Count Titan bridge from start as first jump</span>
        </label>
        <label className="inline-flex items-center gap-2 mr-3">
          <input type="checkbox" className="accent-blue-600" checked={!!settings.allowAnsiblex} onChange={(event) => onSettingsChange({ ...settings, allowAnsiblex: event.target.checked })} />
          <span>Allow Ansiblex jump bridges</span>
        </label>
        <button type="button" className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center justify-center gap-1 leading-none" onClick={onConfigureAnsiblex}>
          <Icon name="gear" size={16} />
          <span className="inline-block align-middle">Configure&hellip;</span>
        </button>
        <button
          type="button"
          className="ml-auto px-2 py-1 text-sm rounded border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 leading-none float-right"
          onClick={onClearSettings}
          title="Clear all saved settings"
        >
          Clear settings
        </button>
      </fieldset>
    </section>
  );
}

export function ScannerWormholeList({
  graph,
  wormholes,
  observatoryItems,
  jumpCounts,
  fromId,
  toId,
  publicShare,
  copyStatuses,
  onWormholesChange,
  onAddNew,
  onPublicShareChange,
  onCopyDiscord,
  onCopyLink,
}: {
  graph: GraphData | null;
  wormholes: ScannerWormhole[];
  observatoryItems: Array<{ id: number; name: string; regionName?: string }>;
  jumpCounts: Map<string, { from: number | null; to: number | null }>;
  fromId: number | null;
  toId: number | null;
  publicShare: boolean;
  copyStatuses: Record<string, CopyStatus>;
  onWormholesChange: Dispatch<SetStateAction<ScannerWormhole[]>>;
  onAddNew: () => void;
  onPublicShareChange: (value: boolean) => void;
  onCopyDiscord: () => void;
  onCopyLink: () => void;
}) {
  return (
    <>
      <div className="flex items-center">
        <h1 className="text-2xl font-semibold">Drifter Scanner</h1>
      </div>

      {wormholes.length === 0 && (
        <p className="text-slate-600 dark:text-slate-300">No wormholes yet. Click "New Wormhole" to add one.</p>
      )}

      <ul className="grid gap-4">
        {wormholes.map((wormhole, index) => (
          <li key={wormhole.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex flex-wrap md:flex-nowrap items-start gap-6">
              <div className="flex-1 min-w-[260px]">
                <div className="font-semibold mb-2">Solar System</div>
                <AutocompleteInput
                  graph={graph}
                  value={wormhole.systemName}
                  onChange={(value) => {
                    const idFromMap = graph?.idsByName ? graph.idsByName[normalizeSystemName(value)] : undefined;
                    const matchId = (typeof idFromMap === 'number' && hasObservatory(graph, idFromMap)) ? idFromMap : null;
                    onWormholesChange((list) => list.map((item, itemIndex) => itemIndex === index ? { ...item, systemName: value, systemId: matchId } : item));
                  }}
                  placeholder="Select..."
                  className="max-w-xs"
                  items={observatoryItems}
                />
              </div>
              <div className="flex-none">
                <div className="font-semibold mb-2">Wormhole Type</div>
                <SegmentedSlider
                  options={wormholeTypeOptions}
                  value={wormhole.type ?? undefined}
                  onChange={(value) => onWormholesChange((list) => list.map((item, itemIndex) => itemIndex === index ? { ...item, type: value as WormholeType } : item))}
                  disableFirstSelectionSlide
                  getColorForValue={wormholeTypeColor}
                />
              </div>
              <div className="flex-none">
                <div className="font-semibold mb-2">Life remaining</div>
                <SegmentedSlider
                  options={eolOptions}
                  value={wormhole.eol ?? undefined}
                  onChange={(value) => onWormholesChange((list) => list.map((item, itemIndex) => itemIndex === index ? { ...item, eol: value as EolLevel } : item))}
                  getColorForValue={eolColor}
                />
              </div>
              <div className="flex-none">
                <div className="font-semibold mb-2">Mass</div>
                <SegmentedSlider
                  options={massOptions}
                  value={wormhole.mass}
                  onChange={(value) => onWormholesChange((list) => list.map((item, itemIndex) => itemIndex === index ? { ...item, mass: value as MassLevel } : item))}
                  getColorForValue={massColor}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600" onClick={() => onWormholesChange((list) => list.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
              <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap truncate">
                {fromId != null && jumpCounts.get(wormhole.id)?.from != null ? `${jumpCounts.get(wormhole.id)?.from} jumps from start` : '-'}
                <span className="mx-2 text-gray-400">&bull;</span>
                {toId != null && jumpCounts.get(wormhole.id)?.to != null ? `${jumpCounts.get(wormhole.id)?.to} jumps from destination` : '-'}
              </span>
              <div className="ml-auto flex items-center gap-4 text-sm text-gray-700 dark:text-gray-300">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={wormhole.bookmarkInside}
                    onChange={(event) => onWormholesChange((list) => list.map((item, itemIndex) => itemIndex === index ? { ...item, bookmarkInside: event.target.checked } : item))}
                  />
                  <span>Bookmark In</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={wormhole.bookmarkOutside}
                    onChange={(event) => onWormholesChange((list) => list.map((item, itemIndex) => itemIndex === index ? { ...item, bookmarkOutside: event.target.checked } : item))}
                  />
                  <span>Bookmark Out</span>
                </label>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="relative flex items-center">
        <div className="w-20 shrink-0" aria-hidden="true" />
        <div className="flex-1 flex justify-center">
          <button onClick={onAddNew} className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">New Wormhole</button>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={publicShare}
              onChange={(event) => onPublicShareChange(event.target.checked)}
            />
            <span>Public link</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCopyDiscord}
              className={getCopyButtonClass(copyStatuses.discord ?? null, "px-2 py-1 text-xs rounded border inline-flex items-center gap-1 transition-colors")}
              aria-label="Copy Discord"
            >
              <Icon
                name={getCopyButtonIconName(copyStatuses.discord ?? null, 'discord')}
                size={14}
                color={getCopyButtonIconColor(copyStatuses.discord ?? null)}
              />
              <span>{getCopyButtonLabel(copyStatuses.discord ?? null, 'Copy Discord')}</span>
            </button>
            <button
              type="button"
              onClick={onCopyLink}
              className={getCopyButtonClass(copyStatuses.link ?? null, "px-2 py-1 text-xs rounded border inline-flex items-center gap-1 transition-colors")}
              aria-label="Copy Link"
            >
              <Icon
                name={getCopyButtonIconName(copyStatuses.link ?? null, 'link')}
                size={14}
                color={getCopyButtonIconColor(copyStatuses.link ?? null)}
              />
              <span>{getCopyButtonLabel(copyStatuses.link ?? null, 'Copy Link')}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function RouteCard({ graph, route }: { graph: GraphData | null; route: ScannerWormholeRoute }) {
  const fromWarning = getWhWarning(route.fromWh);
  const toWarning = getWhWarning(route.toWh);

  return (
    <div className="relative rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-4 bg-white dark:bg-gray-900 mb-4 last:mb-0">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 sm:gap-3.5 text-slate-800 dark:text-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-base sm:text-lg font-semibold tracking-wide text-left">{systemLabel(graph, route.fromWh.systemId, route.fromWh.systemName)}</span>
          <span className="relative h-px flex-1 bg-gray-300 dark:bg-gray-600">
            {fromWarning && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Icon name="warn" size={14} color={fromWarning.color} title={fromWarning.title} />
              </span>
            )}
          </span>
        </div>
        <span className={typePillClass(route.type)}>{route.type}</span>
        <div className="flex items-center gap-2">
          <span className="relative h-px flex-1 bg-gray-300 dark:bg-gray-600">
            {toWarning && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Icon name="warn" size={14} color={toWarning.color} title={toWarning.title} />
              </span>
            )}
          </span>
          <span className="text-base sm:text-lg font-semibold tracking-wide text-right">{systemLabel(graph, route.toWh.systemId, route.toWh.systemName)}</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 text-left">{route.fromJumps} jumps</div>
        <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-medium">Total: {route.total} jumps</div>
        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 text-right">{route.toJumps} jumps</div>
      </div>
    </div>
  );
}

export function ScannerRoutesSidebar({
  graph,
  route,
  fromId,
  toId,
  directGatePath,
  noRoutesMessage,
  filteredWormholeRoutes,
  baseWormholeRoutes,
  extraWormholeRoutes,
  hiddenRouteCount,
  hasHiddenRoutes,
  showAllRoutes,
  filterEolThreshold,
  filterMassThreshold,
  onFilterEolThresholdChange,
  onFilterMassThresholdChange,
  onShowAllRoutesChange,
}: {
  graph: GraphData | null;
  route: { fromQuery: string; toQuery: string };
  fromId: number | null;
  toId: number | null;
  directGatePath: number[] | null;
  noRoutesMessage: string | null;
  filteredWormholeRoutes: ScannerWormholeRoute[];
  baseWormholeRoutes: ScannerWormholeRoute[];
  extraWormholeRoutes: ScannerWormholeRoute[];
  hiddenRouteCount: number;
  hasHiddenRoutes: boolean;
  showAllRoutes: boolean;
  filterEolThreshold: EolLevel;
  filterMassThreshold: MassLevel;
  onFilterEolThresholdChange: (value: EolLevel) => void;
  onFilterMassThresholdChange: (value: MassLevel) => void;
  onShowAllRoutesChange: (value: boolean) => void;
}) {
  const left = systemLabel(graph, fromId, route.fromQuery || '-');
  const right = systemLabel(graph, toId, route.toQuery || '-');

  return (
    <aside className="grid gap-4 md:pl-2 items-start content-start">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-black/20 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Routes</h2>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-slate-800 dark:text-slate-200">
          <div className="inline-flex items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400">Require lifespan:</span>
            <div className="flex-1">
              <SegmentedSlider
                options={eolOptions}
                value={filterEolThreshold}
                onChange={(value) => onFilterEolThresholdChange(value as EolLevel)}
                getColorForValue={eolColor}
              />
            </div>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400">Require mass:</span>
            <div className="flex-1">
              <SegmentedSlider
                options={massOptions}
                value={filterMassThreshold}
                onChange={(value) => onFilterMassThresholdChange(value as MassLevel)}
                getColorForValue={massColor}
              />
            </div>
          </div>
        </div>
        {noRoutesMessage && (
          <div className="text-sm text-slate-600 dark:text-slate-400">{noRoutesMessage}</div>
        )}
        {!noRoutesMessage && filteredWormholeRoutes.length === 0 && (
          <div className="text-sm text-slate-600 dark:text-slate-400">No routes match the selected filters.</div>
        )}
        {baseWormholeRoutes.map((wormholeRoute) => (
          <RouteCard key={wormholeRoute.id} graph={graph} route={wormholeRoute} />
        ))}

        <div className="mt-4 relative rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-4 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-2.5 sm:gap-3.5 text-slate-800 dark:text-slate-100">
            <span className="text-base sm:text-lg font-semibold tracking-wide">{left}</span>
            <span className="h-px flex-1 bg-gray-300 dark:bg-gray-600" />
            <span className="text-base sm:text-lg font-semibold tracking-wide">{right}</span>
          </div>
          <div className="mt-2 text-center text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-medium">
            {directGatePath && directGatePath.length > 0 ? `Total: ${directGatePath.length - 1} jumps` : 'Select start and destination'}
          </div>
        </div>
        <div className="my-3 border-t border-dashed border-gray-300 dark:border-gray-700" />
        {hasHiddenRoutes && !showAllRoutes && (
          <div className="mt-3 text-center">
            <button
              type="button"
              className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => onShowAllRoutesChange(true)}
            >
              Show all routes ({hiddenRouteCount} more)
            </button>
          </div>
        )}
        {hasHiddenRoutes && showAllRoutes && (
          <div className="mt-3 text-center">
            <button
              type="button"
              className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => onShowAllRoutesChange(false)}
            >
              Hide extra routes
            </button>
          </div>
        )}
        {hasHiddenRoutes && showAllRoutes && (
          <div className="mt-3 grid gap-4">
            {extraWormholeRoutes.map((wormholeRoute) => (
              <RouteCard key={wormholeRoute.id} graph={graph} route={wormholeRoute} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
