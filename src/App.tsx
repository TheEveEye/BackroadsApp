import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { loadData, type GraphData } from './lib/data';
import { bfsObservatories, type ObservatoryHit } from './lib/graph';
import { Results } from './components/Results';
import { MapView } from './components/MapView';
import { SearchForm } from './components/SearchForm';
import { Icon } from './components/Icon';
import { AnsiblexModal as SharedAnsiblexModal } from './components/AnsiblexModal';
import { ConfirmDialog } from './components/ConfirmDialog';

function App() {
  const SETTINGS_STORAGE_KEY = 'br.settings.v1';
  const UI_STORAGE_KEY = 'br.ui.v1';
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.query === 'string') return parsed.query;
      }
    } catch {}
    return '';
  });
  const [maxJumps, setMaxJumps] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Number.isFinite(parsed.maxJumps)) return Number(parsed.maxJumps);
      }
    } catch {}
    return 5;
  });
  const [lyRadius, setLyRadius] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Number.isFinite(parsed.lyRadius)) return Number(parsed.lyRadius);
      }
    } catch {}
    return 6;
  });
  const [startId, setStartId] = useState<number | null>(null);
  const [settings, setSettings] = useState<{ excludeZarzakh: boolean; sameRegionOnly: boolean; titanBridgeFirstJump: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }> }>(() => {
    const defaults = { excludeZarzakh: true, sameRegionOnly: false, titanBridgeFirstJump: false, allowAnsiblex: false, ansiblexes: [] as Array<{ from: number; to: number; enabled?: boolean }> };
    try {
      const raw = localStorage.getItem('br.settings.v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            ...defaults,
            excludeZarzakh: typeof parsed.excludeZarzakh === 'boolean' ? parsed.excludeZarzakh : defaults.excludeZarzakh,
            sameRegionOnly: typeof parsed.sameRegionOnly === 'boolean' ? parsed.sameRegionOnly : defaults.sameRegionOnly,
            titanBridgeFirstJump: typeof parsed.titanBridgeFirstJump === 'boolean' ? parsed.titanBridgeFirstJump : defaults.titanBridgeFirstJump,
            allowAnsiblex: typeof parsed.allowAnsiblex === 'boolean' ? parsed.allowAnsiblex : defaults.allowAnsiblex,
            ansiblexes: Array.isArray(parsed.ansiblexes) ? parsed.ansiblexes : defaults.ansiblexes,
          };
        }
      }
      // Fallback: dedicated Ansiblex key
      const rawAX = localStorage.getItem('br.ansiblex.v1');
      if (rawAX) {
        const arr = JSON.parse(rawAX);
        if (Array.isArray(arr) && arr.length > 0) {
          return { ...defaults, ansiblexes: arr, allowAnsiblex: true };
        }
      }
    } catch {}
    return defaults;
  });
  const [showAnsiblexModal, setShowAnsiblexModal] = useState(false);

  // Toasts (top-rightish)
  const toastSeq = useRef(1);
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; type: 'warn' | 'info' | 'success'; visible: boolean }>>([]);
  const pushToast = (msg: string, type: 'warn' | 'info' | 'success' = 'info') => {
    const id = toastSeq.current++;
    setToasts((ts) => [...ts, { id, msg, type, visible: false }]);
    requestAnimationFrame(() => setToasts((ts) => ts.map(t => t.id === id ? { ...t, visible: true } : t)));
    setTimeout(() => setToasts((ts) => ts.map(t => t.id === id ? { ...t, visible: false } : t)), 3500);
    setTimeout(() => setToasts((ts) => ts.filter(t => t.id !== id)), 4000);
  };

  // Open modal when SearchForm dispatches event
  useEffect(() => {
    const onOpen = () => setShowAnsiblexModal(true);
    window.addEventListener('open-ansiblex-modal', onOpen as any);
    return () => window.removeEventListener('open-ansiblex-modal', onOpen as any);
  }, []);

  // removed load-on-mount effect; initialization now reads localStorage synchronously

  // Persist settings on change
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // Persist Ansiblex list separately as well (for robustness and portability)
  useEffect(() => {
    try {
      localStorage.setItem('br.ansiblex.v1', JSON.stringify(settings.ansiblexes || []));
    } catch {}
  }, [settings.ansiblexes]);

  const results = useMemo<ObservatoryHit[]>(() => {
    if (!graph || startId == null) return [];
    return bfsObservatories({ startId, maxJumps, graph, settings, lyRadius });
  }, [graph, startId, maxJumps, settings, lyRadius]);

  // Wrap settings setter to show a warning when enabling titan bridge from high-sec
  const setSettingsWithGuard = (next: { excludeZarzakh: boolean; sameRegionOnly: boolean; titanBridgeFirstJump: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }> }) => {
    try {
      if (!settings.titanBridgeFirstJump && next.titanBridgeFirstJump) {
        if (startId != null && graph) {
          const s = graph.systems[String(startId)];
          const sec = typeof s?.security === 'number' ? s.security : 0;
          if (sec >= 0.5) {
            pushToast('Titan bridges cannot be used to or from high-sec systems.', 'warn');
          }
        }
      }
    } catch {}
    setSettings(next);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const pre = (window as any).appGraph as GraphData | undefined;
        const data = pre ?? await loadData();
        if (!cancelled) {
          setGraph(data);
          (window as any).appGraph = data;
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

  // Persist basic UI state (query, maxJumps, lyRadius)
  useEffect(() => {
    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ query, maxJumps, lyRadius }));
    } catch {}
  }, [query, maxJumps, lyRadius]);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const doClearAll = () => {
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      localStorage.removeItem('br.ansiblex.v1');
      localStorage.removeItem(UI_STORAGE_KEY);
    } catch {}
    setSettings({ excludeZarzakh: true, sameRegionOnly: false, titanBridgeFirstJump: false, allowAnsiblex: false, ansiblexes: [] });
    setQuery('');
    setMaxJumps(5);
    setLyRadius(6);
    pushToast('Settings cleared', 'success');
  };
  const onClearAll = () => setShowClearConfirm(true);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Jove Observatory Finder</h1>
      </header>
      <main className="grid gap-6 md:grid-cols-2">
        {/* Toast container */}
        <div className="fixed top-3 left-0 right-0 z-50 pointer-events-none">
          <div className="mx-auto w-full max-w-md px-3 flex flex-col items-center">
            {toasts.map(t => (
              <div
                key={t.id}
                className={`pointer-events-auto mb-2 px-3 py-2 rounded-md border shadow flex items-center gap-2 transition-all duration-300 transform ${t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'} ${t.type === 'warn' ? 'bg-amber-100 border-amber-300 text-amber-900' : t.type === 'success' ? 'bg-green-100 border-green-300 text-green-900' : 'bg-blue-100 border-blue-300 text-blue-900'}`}
              >
                <Icon name={t.type === 'warn' ? 'warn' : 'export'} size={16} color={t.type === 'warn' ? '#b45309' : t.type === 'success' ? '#166534' : '#1d4ed8'} />
                <span className="text-sm">{t.msg}</span>
              </div>
            ))}
          </div>
        </div>
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
            setSettings={setSettingsWithGuard}
            onClearAll={onClearAll}
          
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
      {showAnsiblexModal && (
  <SharedAnsiblexModal
          onClose={() => setShowAnsiblexModal(false)}
          value={settings.ansiblexes || []}
          onChange={(list) => setSettings(s => ({ ...s, ansiblexes: list }))}
        />
      )}
      <ConfirmDialog
        open={showClearConfirm}
        title="Clear Settings"
        message="Do you wish to clear all settings, including Ansiblex connections?"
        confirmLabel="Clear"
        cancelLabel="Cancel"
        tone="warn"
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={() => { doClearAll(); setShowClearConfirm(false); }}
      />
      <footer>
        <small>Data: systems_index.json (client-side only)</small>
      </footer>
    </div>
  );
}

export default App;
