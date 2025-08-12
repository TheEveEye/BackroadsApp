import type { ObservatoryHit } from '../lib/graph';

export function Results({ results, namesById, lyRadius, graph }: { results: ObservatoryHit[]; namesById?: Record<string, string>; lyRadius: number; graph: any }) {
  const LY = 9.4607e15;
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
  const titanImg = `${base}titan.png`;

  return (
    <section className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-medium mb-3">Found {results.length} observatory system(s)</h2>
      <ol className="pl-5 space-y-3">
        {results.map((r) => {
          const name = namesById?.[String(r.systemId)];
          const sys = graph.systems[String(r.systemId)];
          const regionName = graph.regionsById?.[String(sys?.regionId)] ?? (sys?.regionId ?? '');
          const ly = distanceLyFor(r);
          return (
            <li key={r.systemId}>
              
              <div className="flex gap-2 items-center flex-wrap">
                <strong>{(name ?? r.systemId) + ' • ' + regionName}</strong>
                <span>• {r.distance} jump(s)</span>
                <span>• {ly != null ? <span>{ly.toFixed(1)} ly {ly > lyRadius ? <span title="Beyond radius" className="text-amber-600">⚠︎</span> : null}</span> : '—'}</span>
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
                            src={titanImg}
                            alt="Titan bridge"
                            title="Titan bridge"
                            style={{ display: 'inline-block', verticalAlign: 'middle', width: 18, height: 18, margin: '0 6px' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
