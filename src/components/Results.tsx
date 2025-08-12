import type { ObservatoryHit } from '../lib/graph';
import { Icon } from './Icon';

export function Results({ results, namesById, lyRadius, graph }: { results: ObservatoryHit[]; namesById?: Record<string, string>; lyRadius: number; graph: any }) {
  const LY = 9.4607e15;
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
  const titanSvg = `${base}titan.svg`;
  const titanPng = `${base}titan.png`;

  return (
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-medium mb-3">Found {results.length} observatory system(s)</h2>
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
