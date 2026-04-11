import type { ObservatoryHit } from '../lib/graph';
import { getCopyButtonClass, getCopyButtonIconColor, getCopyButtonIconName, getCopyButtonLabel, useCopyStatuses } from '../lib/copy';
import { Icon } from './Icon';
import { useMemo, useState } from 'react';

export function Results({ results, namesById, lyRadius, graph }: { results: ObservatoryHit[]; namesById?: Record<string, string>; lyRadius: number; graph: any }) {
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
  function distanceLyFor(r: any): number | null {
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
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="relative flex items-center justify-between mb-3">
        <h2 className="text-xl font-medium">Found {results.length} observatory system(s)</h2>
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
      <ol className="pl-5 space-y-3">
        {results.map((r) => {
          const name = namesById?.[String(r.systemId)];
          const sys = graph.systems[String(r.systemId)];
          const regionName = graph.regionsById?.[String(sys?.regionId)] ?? (sys?.regionId ?? '');
          const ly = distanceLyFor(r);
          const { color, label } = secInfo(sys?.security);
          return (
            <li key={r.systemId}>
              
              <div className="flex gap-2 items-center flex-wrap">
                <strong className="flex items-center gap-1">
                  <span>{name ?? r.systemId}</span>
                  <span style={{ color, fontWeight: 'bold' }}>{label}</span>
                  <span>• {regionName}</span>
                </strong>
                <span>• {r.distance} jump(s)</span>
                <span>• {ly != null ? (
                  <span>
                    {ly.toFixed(1)} ly{' '}
                    {ly > lyRadius ? (
                      <span title="Beyond radius" className="inline-flex items-center align-middle">
                        <Icon name="warn" size={14} color="#d97706" />
                      </span>
                    ) : null}
                  </span>
                ) : '—'}</span>
              </div>
              <details className="mt-1">
                <summary>Path</summary>
                {(() => {
                  const path: number[] = r.path || [];
                  if (!Array.isArray(path) || path.length === 0) return <code>—</code>;
                  const startId = path[0];
                  const nextId = path.length > 1 ? path[1] : null;
                  const startSys = graph.systems[String(startId)];
                  const usedTitan = !!nextId && startSys && !startSys.adjacentSystems.includes(nextId);
                  const chips: any[] = [];
                  for (let i = 0; i < path.length; i++) {
                    const id = path[i];
                    const label = namesById?.[String(id)] ?? String(id);
                    chips.push(<code key={`n-${i}`}>{label}</code>);
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
                        chips.push(<span key={`sep-${i}`} aria-hidden="true"> {' '}→{' '} </span>);
                      }
                    }
                  }
                  return <div className="flex flex-wrap gap-0.5 items-center">{chips}</div>;
                })()}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
