import type { ReactNode } from 'react';
import type { CopyStatus } from '../lib/copy';
import { getCopyButtonClass, getCopyButtonIconColor, getCopyButtonIconName, getCopyButtonLabel } from '../lib/copy';
import type { JumpTimerStop, TimerMode } from '../lib/jumpTimers';
import { Icon } from './Icon';

export type BridgePlannerRouteOption = {
  key: string;
  bridgeLegs: Array<{
    parkingId: number;
    endpointId: number;
    approachPath: number[];
    approachJumps: number;
    bridgeLy: number;
  }>;
  postBridgePaths: number[][];
  postBridgeJumps: number;
  totalJumps: number;
  totalBridges: number;
  waypointIds?: number[];
};

type CopyMenuOption = {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

function CopyMenuButton({
  status,
  isOpen,
  onOpen,
  onClose,
  disabled,
  options,
  stopClicks,
}: {
  status: CopyStatus | null;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  disabled?: boolean;
  options: CopyMenuOption[];
  stopClicks?: boolean;
}) {
  return (
    <div className="relative">
      <div
        className="relative"
        onMouseLeave={onClose}
      >
        <button
          type="button"
          className={getCopyButtonClass(status, "px-2 py-1 text-xs rounded border inline-flex items-center gap-1 transition-colors")}
          disabled={disabled}
          aria-label="Copy"
          onMouseEnter={onOpen}
          onClick={stopClicks ? (event) => event.stopPropagation() : undefined}
        >
          <Icon
            name={getCopyButtonIconName(status)}
            size={14}
            color={getCopyButtonIconColor(status)}
          />
          <span>{getCopyButtonLabel(status)}</span>
        </button>
        {isOpen && (
          <div className="absolute right-0 top-full pt-1 z-10">
            <div
              className="min-w-[180px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden"
              onMouseEnter={onOpen}
              onClick={stopClicks ? (event) => event.stopPropagation() : undefined}
            >
              {options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={option.onSelect}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  disabled={option.disabled}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BridgeRoutesPanel({
  loading,
  message,
  displayRoutes,
  selectedRoute,
  displayStagingId,
  displayDestinationId,
  routesToShow,
  eveLinksMarkup,
  plainTextRoutes,
  copyStatuses,
  headerCopyOpen,
  routeCopyOpenKey,
  isBridgeOnlyMode,
  routeTravelMinutesByKey,
  timersLoading,
  onCopyText,
  onHeaderCopyOpenChange,
  onRouteCopyOpenKeyChange,
  onRoutesToShowChange,
  onSelectRoute,
  renderSystemName,
  getBridgeSequence,
  getRouteBridgeLy,
  calculateRouteIsotopes,
  formatIsotopes,
  formatTimerMinutes,
  buildRouteCopyPayload,
}: {
  loading: boolean;
  message: string | null;
  displayRoutes: Array<{ route: BridgePlannerRouteOption | null; placeholder: boolean }>;
  selectedRoute: BridgePlannerRouteOption | null;
  displayStagingId: number | null;
  displayDestinationId: number | null;
  routesToShow: number;
  eveLinksMarkup: string;
  plainTextRoutes: string;
  copyStatuses: Record<string, CopyStatus>;
  headerCopyOpen: boolean;
  routeCopyOpenKey: string | null;
  isBridgeOnlyMode: boolean;
  routeTravelMinutesByKey: Record<string, number>;
  timersLoading: boolean;
  onCopyText: (text: string, target: string) => void;
  onHeaderCopyOpenChange: (open: boolean) => void;
  onRouteCopyOpenKeyChange: (key: string | null) => void;
  onRoutesToShowChange: (count: number) => void;
  onSelectRoute: (routeKey: string) => void;
  renderSystemName: (id: number | null) => ReactNode;
  getBridgeSequence: (route: BridgePlannerRouteOption) => number[];
  getRouteBridgeLy: (route: BridgePlannerRouteOption) => number;
  calculateRouteIsotopes: (route: BridgePlannerRouteOption) => number | null;
  formatIsotopes: (value: number) => string;
  formatTimerMinutes: (minutes: number) => string;
  buildRouteCopyPayload: (route: BridgePlannerRouteOption) => { eve: string; plain: string };
}) {
  const hasRoutes = displayRoutes.some((item) => item.route);
  const headerCopyState = copyStatuses.header ?? null;

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Routes</h2>
          {loading && <span className="text-xs text-slate-500">Updating&hellip;</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CopyMenuButton
            status={headerCopyState}
            isOpen={headerCopyOpen}
            onOpen={() => onHeaderCopyOpenChange(true)}
            onClose={() => onHeaderCopyOpenChange(false)}
            disabled={!eveLinksMarkup && !plainTextRoutes}
            options={[
              {
                label: 'Copy EVE in-game links',
                disabled: !eveLinksMarkup,
                onSelect: () => {
                  onHeaderCopyOpenChange(false);
                  if (eveLinksMarkup) onCopyText(eveLinksMarkup, 'header');
                },
              },
              {
                label: 'Copy plain text',
                disabled: !plainTextRoutes,
                onSelect: () => {
                  onHeaderCopyOpenChange(false);
                  if (plainTextRoutes) onCopyText(plainTextRoutes, 'header');
                },
              },
            ]}
          />
          <span>Show</span>
          <select
            className="rounded border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-2 py-1 text-xs"
            value={routesToShow}
            onChange={(event) => onRoutesToShowChange(Number(event.target.value))}
          >
            {[5, 10, 15, 20, 25].map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
          <span>routes</span>
        </div>
      </div>
      {!loading && !hasRoutes ? (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          {message || 'No routes available.'}
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          {displayRoutes.map((item, index) => {
            const route = item.route;
            if (!route) {
              return (
                <div
                  key={`placeholder-${index}`}
                  className="relative w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-gray-900/30 px-4 py-3"
                  aria-hidden="true"
                >
                  <div className="h-4 w-3/4 rounded bg-slate-200/80 dark:bg-slate-700/50" />
                  <div className="mt-2 h-3 w-2/3 rounded bg-slate-200/70 dark:bg-slate-700/40" />
                </div>
              );
            }

            const isSelected = selectedRoute?.key === route.key;
            const routeTravelMinutes = isBridgeOnlyMode ? routeTravelMinutesByKey[route.key] ?? null : null;
            const chainIds = getBridgeSequence(route);
            const displayChainIds = displayStagingId != null && chainIds[0] !== displayStagingId ? [displayStagingId, ...chainIds] : chainIds;
            const stopChainIds = [
              displayStagingId,
              ...(route.waypointIds ?? []),
              displayDestinationId,
            ].filter((id): id is number => id != null);
            const gateDetails = route.bridgeLegs
              .map((leg, legIndex) => leg.approachJumps > 0 ? `${leg.approachJumps}j to park${route.bridgeLegs.length > 1 ? ` ${legIndex + 1}` : ''}` : null)
              .filter((value): value is string => value != null);
            if (route.postBridgeJumps > 0) gateDetails.push(`${route.postBridgeJumps}j after`);
            const routeBridgeLy = getRouteBridgeLy(route);
            const routeIsotopes = isBridgeOnlyMode ? calculateRouteIsotopes(route) : null;
            const routeCopyState = copyStatuses[route.key] ?? null;
            const routeDetailParts = [
              `${routeBridgeLy.toFixed(2)} ly`,
              routeTravelMinutes != null ? formatTimerMinutes(routeTravelMinutes) : null,
              isBridgeOnlyMode && routeTravelMinutes == null && timersLoading ? 'calculating...' : null,
              ...gateDetails,
              routeIsotopes != null ? `${formatIsotopes(routeIsotopes)} isotopes` : null,
            ].filter((part): part is string => part != null);

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
                onClick={() => onSelectRoute(route.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectRoute(route.key);
                  }
                }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 text-left pointer-events-none">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                      {displayChainIds.map((id, chainIndex) => (
                        <span key={`${route.key}-${id}-${chainIndex}`} className="inline-flex items-center gap-x-1 gap-y-0.5 flex-wrap">
                          {chainIndex > 0 && <span aria-hidden="true">&rarr;</span>}
                          {renderSystemName(id)}
                        </span>
                      ))}
                      {displayDestinationId != null && displayChainIds[displayChainIds.length - 1] !== displayDestinationId && (
                        <span className="inline-flex items-center gap-x-1 gap-y-0.5 flex-wrap">
                          <span aria-hidden="true">&rarr;</span>
                          {renderSystemName(displayDestinationId)}
                        </span>
                      )}
                    </div>
                    {route.waypointIds && route.waypointIds.length > 0 && (
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                        <span>Stops:</span>
                        {stopChainIds.map((id, chainIndex) => (
                          <span key={`${route.key}-stop-${id}-${chainIndex}`} className="inline-flex items-center gap-x-1 gap-y-0.5 flex-wrap">
                            {chainIndex > 0 && <span aria-hidden="true">&rarr;</span>}
                            {renderSystemName(id)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2 self-start" onClick={(event) => event.stopPropagation()}>
                    {index === 0 && (
                      <span className="text-[10px] uppercase tracking-wide rounded-full bg-amber-200 text-amber-900 px-2 py-0.5">
                        Best
                      </span>
                    )}
                    <CopyMenuButton
                      status={routeCopyState}
                      isOpen={routeCopyOpenKey === route.key}
                      onOpen={() => onRouteCopyOpenKeyChange(route.key)}
                      onClose={() => onRouteCopyOpenKeyChange(null)}
                      stopClicks
                      options={[
                        {
                          label: 'Copy EVE in-game links',
                          onSelect: () => {
                            const payload = buildRouteCopyPayload(route);
                            onRouteCopyOpenKeyChange(null);
                            if (payload.eve) onCopyText(payload.eve, route.key);
                          },
                        },
                        {
                          label: 'Copy plain text',
                          onSelect: () => {
                            const payload = buildRouteCopyPayload(route);
                            onRouteCopyOpenKeyChange(null);
                            if (payload.plain) onCopyText(payload.plain, route.key);
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300 pointer-events-none">
                  <span className="min-w-0">
                    {routeDetailParts.map((part, partIndex) => (
                      <span key={`${route.key}-detail-${partIndex}`}>
                        {partIndex > 0 && <span> &bull; </span>}
                        {part === 'calculating...' ? <>calculating&hellip;</> : part}
                      </span>
                    ))}
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
  );
}

export function JumpTimersPanel({
  timerMode,
  fatigueReduction,
  startingFatigueMinutes,
  startingActivationMinutes,
  selectedRoute,
  loading,
  timerStops,
  selectedRouteIsotopes,
  onTimerModeChange,
  nameFor,
  formatTimerMinutes,
  formatRelativeTimer,
  formatIsotopes,
}: {
  timerMode: TimerMode;
  fatigueReduction: number;
  startingFatigueMinutes: number;
  startingActivationMinutes: number;
  selectedRoute: BridgePlannerRouteOption | null;
  loading: boolean;
  timerStops: JumpTimerStop[];
  selectedRouteIsotopes: number | null;
  onTimerModeChange: (mode: TimerMode) => void;
  nameFor: (id: number | null) => string;
  formatTimerMinutes: (minutes: number) => string;
  formatRelativeTimer: (minutes: number) => string;
  formatIsotopes: (value: number) => string;
}) {
  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Jump timers</h2>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>Mode</span>
            <select
              className="rounded border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-2 py-1 text-xs"
              value={timerMode}
              onChange={(event) => {
                const nextMode = event.target.value === 'jump-asap' ? 'jump-asap' : 'fastest-arrival';
                onTimerModeChange(nextMode);
              }}
            >
              <option value="fastest-arrival">Fastest arrival</option>
              <option value="jump-asap">Jump ASAP</option>
            </select>
          </label>
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-300 text-right">
          <span>Fatigue reduction {fatigueReduction}%</span>
          {selectedRouteIsotopes != null && (
            <span> &bull; {formatIsotopes(selectedRouteIsotopes)} isotopes</span>
          )}
        </div>
      </div>
      {(startingFatigueMinutes > 0 || startingActivationMinutes > 0) && (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
          Starts with {formatTimerMinutes(startingFatigueMinutes)} fatigue and {formatTimerMinutes(startingActivationMinutes)} activation.
        </p>
      )}
      {!selectedRoute ? (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Select a route to see timer details.</p>
      ) : loading && timerStops.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Calculating jump timers&hellip;</p>
      ) : timerStops.length === 0 ? (
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
              {timerStops.map((stop) => (
                <tr key={`${stop.fromId}-${stop.toId}-${stop.index}`}>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{stop.index}</span>
                    <span className="ml-1 text-slate-500 dark:text-slate-400">{nameFor(stop.toId)}</span>
                  </td>
                  <td className="py-2 pr-3 min-w-[140px]">
                    {nameFor(stop.fromId)} &rarr; {nameFor(stop.toId)}
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
  );
}
