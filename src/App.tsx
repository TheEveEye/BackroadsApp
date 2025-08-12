import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { loadData, type GraphData } from './lib/data';
import { bfsObservatories, type ObservatoryHit } from './lib/graph';
import { Results } from './components/Results';
import { MapView } from './components/MapView';
import { SearchForm } from './components/SearchForm';

function App() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [maxJumps, setMaxJumps] = useState(5);
  const [lyRadius, setLyRadius] = useState(6);
  const [startId, setStartId] = useState<number | null>(null);
  const [settings, setSettings] = useState<{ excludeZarzakh: boolean; sameRegionOnly: boolean }>({ excludeZarzakh: false, sameRegionOnly: false });

  const results = useMemo<ObservatoryHit[]>(() => {
    if (!graph || startId == null) return [];
    return bfsObservatories({ startId, maxJumps, graph, settings });
  }, [graph, startId, maxJumps, settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await loadData();
        if (!cancelled) {
          setGraph(data);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Jove Observatory Finder</h1>
      </header>
      <main className="grid gap-6 md:grid-cols-2">
        <section className="grid gap-6">
          <SearchForm
            query={query}
            setQuery={setQuery}
            maxJumps={maxJumps}
            setMaxJumps={setMaxJumps}
          lyRadius={lyRadius}
          setLyRadius={setLyRadius}
            graph={graph}
            onStartId={(id) => setStartId(id)}
          
            settings={settings}
            setSettings={setSettings}
          
            />
          {loading && <p>Loading data…</p>}
          {error && <p className="text-red-600">{error} — ensure systems_index.json is present under public/data/</p>}

          {!loading && !error && startId != null && (
            <Results results={results} namesById={graph?.namesById || {}} lyRadius={lyRadius} graph={graph} />
          )}
        </section>
        <section>
          {!loading && !error && startId != null && graph ? (
            <MapView
              startId={startId}
              maxJumps={maxJumps}
              graph={graph}
              namesById={graph.namesById}
                lyRadius={lyRadius}
                settings={settings}
            />
          ) : (
            <div className="bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-medium mb-3">Map</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">Select a system to view the map.</p>
            </div>
          )}
        </section>
      </main>
      <footer>
        <small>Data: systems_index.json (client-side only)</small>
      </footer>
    </div>
  );
}

export default App;
