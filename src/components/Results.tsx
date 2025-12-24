import type { ObservatoryHit } from '../lib/graph';
import { Icon } from './Icon';
import { useMemo, useState } from 'react';

export function Results({ results, namesById, lyRadius, graph }: { results: ObservatoryHit[]; namesById?: Record<string, string>; lyRadius: number; graph: any }) {
  const LY = 9.4607e15;
  const [copyStatus, setCopyStatus] = useState<null | 'success' | 'error'>(null);
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

  if (!results.length) return <p>No observatories found within the selected jump range.</p>;

  const base = (import.meta as any).env?.BASE_URL || '/';
  const titanSvg = `${base}ships/titan.svg`;
  const titanPng = `${base}ships/titan.png`;

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

  const handleCopyNames = () => copyText(systemNames.join('\n'));
  const handleCopyEveLinks = () => copyText(eveLinksMarkup);

  return (
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="relative flex items-center justify-between mb-3">
        <h2 className="text-xl font-medium">Found {results.length} observatory system(s)</h2>
        <div className="relative">
          {copyStatus && (
            <div className={"pointer-events-none absolute -top-8 right-0 px-3 py-1.5 rounded shadow text-sm inline-flex items-center gap-2 " + (copyStatus === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white')} role="status" aria-live="polite">
              <Icon name={copyStatus === 'success' ? 'copy' : 'warn'} size={14} color="white" />
              {copyStatus === 'success' ? 'Copied!' : 'Copy failed'}
            </div>
          )}
          <div
            className="relative"
            onMouseLeave={() => setCopyOpen(false)}
          >
            <button
              type="button"
              aria-label="Copy"
              className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              onMouseEnter={() => setCopyOpen(true)}
            >
              <Icon name="copy" size={18} />
            </button>
            {copyOpen && (
              <div className="absolute right-0 top-full pt-1 z-10">
                <div
                  className="min-w-[180px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden"
                  onMouseEnter={() => setCopyOpen(true)}
                >
                  <button
                    type="button"
                    onClick={handleCopyNames}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Copy system names
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyEveLinks}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Copy EVE in-game links
                  </button>
                </div>
              </div>
            )}
          </div>
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
                          <img
                            key={`sep-${i}`}
                            src={titanSvg}
                            alt="Titan bridge"
                            title="Titan bridge"
                            style={{ display: 'inline-block', verticalAlign: 'middle', width: 18, height: 18, margin: '0 6px' }}
                            onError={(e) => {
                              const img = e.target as HTMLImageElement;
                              if (!img.dataset.fallback) {
                                img.dataset.fallback = '1';
                                img.src = titanPng;
                              } else {
                                img.style.display = 'none';
                              }
                            }}
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
