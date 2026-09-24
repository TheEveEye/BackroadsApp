import type { ObservatoryHit } from '../lib/graph';
import type { GraphData } from '../lib/data';
import { getCopyButtonClass, getCopyButtonIconColor, getCopyButtonIconName, getCopyButtonLabel, useCopyStatuses } from '../lib/copy';
import { Icon } from './Icon';
import { useMemo, useState, type ReactNode } from 'react';

export type DestinationMode = 'append' | 'replace';

type PendingDestination = {
  systemId: number;
  mode: DestinationMode;
} | null;

export function Results({
  results,
  namesById,
  lyRadius,
  graph,
  onSetDestination,
  pendingDestination,
}: {
  results: ObservatoryHit[];
  namesById?: Record<string, string>;
  lyRadius: number;
  graph: GraphData;
  onSetDestination: (systemId: number, mode: DestinationMode) => Promise<void>;
  pendingDestination: PendingDestination;
}) {
  const LY = 9.4607e15;
  const { copyStatuses, copyText } = useCopyStatuses();
  const [copyOpen, setCopyOpen] = useState(false);
  const SEC_COLORS = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
  const secInfo = (s: number | undefined | null) => {
    const val = typeof s === 'number' ? s : 0;
    const idx = val <= 0 ? 0 : Math.min(10, Math.ceil(val * 10));
    const color = SEC_COLORS[idx] || SEC_COLORS[0];
    const label = val.toFixed(1);
    return { color, label };
  };
  function distanceLyFor(r: ObservatoryHit): number | null {
    try {
      const startId = r.path[0];
      const endId = r.systemId;
      const a = graph.systems[String(startId)].position;
      const b = graph.systems[String(endId)].position;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); // 3D distance
      return d / LY;
    } catch {
      return null;
    }
  }

  // Precompute lists for copying
  const systemNames = useMemo(() => results.map(r => namesById?.[String(r.systemId)] ?? String(r.systemId)), [results, namesById]);
  const eveLinksMarkup = useMemo(() => {
    const anchors = systemNames.map((name, i) => {
      const id = results[i]?.systemId;
      return `<a href="showinfo:5//${id}">${name}</a>`;
    });
    const body = anchors.join('<br>');
    return `<font size="13" color="#bfffffff"></font><font size="13" color="#ffd98d00"><loc>${body}</loc></font>`;
  }, [results, systemNames]);

  if (!results.length) return <p>No observatories found within the selected jump range.</p>;

  const handleCopyNames = () => copyText(systemNames.join('\n'), 'observatories');
  const handleCopyEveLinks = () => copyText(eveLinksMarkup, 'observatories');

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
      <div className="relative flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Observatory systems</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {results.length} {results.length === 1 ? 'system' : 'systems'} found
          </p>
        </div>
        <div className="relative">
          {(() => {
            const copyState = copyStatuses.observatories ?? null;
            return (
          <div
            className="relative"
            onMouseLeave={() => setCopyOpen(false)}
          >
            <button
              type="button"
              aria-label="Copy"
              className={getCopyButtonClass(copyState, "px-2 py-1 text-xs rounded border inline-flex items-center gap-1 transition-colors")}
              onMouseEnter={() => setCopyOpen(true)}
            >
              <Icon
                name={getCopyButtonIconName(copyState)}
                size={14}
                color={getCopyButtonIconColor(copyState)}
              />
              <span>{getCopyButtonLabel(copyState)}</span>
            </button>
            {copyOpen && (
              <div className="absolute right-0 top-full pt-1 z-10">
                <div
                  className="min-w-[180px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden"
                  onMouseEnter={() => setCopyOpen(true)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCopyOpen(false);
                      handleCopyNames();
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Copy system names
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCopyOpen(false);
                      handleCopyEveLinks();
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Copy EVE in-game links
                  </button>
                </div>
              </div>
            )}
          </div>
            );
          })()}
        </div>
      </div>
      <ol className="divide-y divide-slate-200 dark:divide-slate-800">
        {results.map((r) => {
          const name = namesById?.[String(r.systemId)];
          const sys = graph.systems[String(r.systemId)];
          const regionName = graph.regionsById?.[String(sys?.regionId)] ?? (sys?.regionId ?? '');
          const ly = distanceLyFor(r);
          const { color, label } = secInfo(sys?.security);
          const isAppending = pendingDestination?.systemId === r.systemId && pendingDestination.mode === 'append';
          const isReplacing = pendingDestination?.systemId === r.systemId && pendingDestination.mode === 'replace';
          const destinationRequestPending = pendingDestination != null;
          return (
            <li key={r.systemId} className="px-4 py-2.5 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/50">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <h3 className="mr-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {name ?? r.systemId}
                </h3>
                <span
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold dark:bg-slate-800"
                  style={{ color }}
                  title="System security status"
                >
                  {label}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{regionName}</span>
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {r.distance} {r.distance === 1 ? 'jump' : 'jumps'}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  {ly != null ? `${ly.toFixed(1)} ly` : 'Distance unavailable'}
                  {ly != null && ly > lyRadius ? (
                    <Icon name="warn" size={13} color="#d97706" ariaLabel="Beyond bridge radius" title="Beyond bridge radius" />
                  ) : null}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void onSetDestination(r.systemId, 'append')}
                    disabled={destinationRequestPending}
                    aria-label={`Append ${name ?? r.systemId} to the in-game route`}
                    title="Append to in-game route"
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Icon name="append-route" size={14} />
                    {isAppending ? 'Appending…' : 'Append'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onSetDestination(r.systemId, 'replace')}
                    disabled={destinationRequestPending}
                    aria-label={`Set ${name ?? r.systemId} as the in-game destination`}
                    title="Replace in-game route with this destination"
                    className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    <Icon name="set-destination" size={14} />
                    {isReplacing ? 'Setting…' : 'Set destination'}
                  </button>
                </div>
              </div>
              <details className="group mt-1.5">
                <summary className="w-fit cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
                  Show route path
                </summary>
                {(() => {
                  const path: number[] = r.path || [];
                  if (!Array.isArray(path) || path.length === 0) return <code>—</code>;
                  const startId = path[0];
                  const nextId = path.length > 1 ? path[1] : null;
                  const startSys = graph.systems[String(startId)];
                  const usedTitan = !!nextId && startSys && !startSys.adjacentSystems.includes(nextId);
                  const chips: ReactNode[] = [];
                  for (let i = 0; i < path.length; i++) {
                    const id = path[i];
                    const label = namesById?.[String(id)] ?? String(id);
                    chips.push(
                      <code key={`n-${i}`} className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                        {label}
                      </code>
                    );
                    if (i < path.length - 1) {
                      if (i === 0 && usedTitan) {
                        chips.push(
                          <Icon
                            key={`sep-${i}`}
                            ship="Titan Bridge"
                            size={18}
                            ariaLabel="Titan bridge"
                            title="Titan bridge"
                            className="mx-1.5"
                          />
                        );
                      } else {
                        chips.push(<span key={`sep-${i}`} className="text-slate-400" aria-hidden="true">→</span>);
                      }
                    }
                  }
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100/80 p-2.5 dark:bg-slate-900">
                      {chips}
                    </div>
                  );
                })()}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
