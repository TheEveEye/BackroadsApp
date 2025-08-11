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
                <code>{r.path.map((id) => namesById?.[String(id)] ?? String(id)).join(' → ')}</code>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
