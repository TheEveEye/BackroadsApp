import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { loadData, type GraphData } from './lib/data';
import { bfsObservatories, type ObservatoryHit } from './lib/graph';
import { Results } from './components/Results';
import { MapView } from './components/MapView';
import { SearchForm } from './components/SearchForm';
import { AutocompleteInput } from './components/AutocompleteInput';
import { Icon } from './components/Icon';
import { resolveQueryToId } from './lib/graph';

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

  const onClearAll = () => {
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
  <AnsiblexModal
          onClose={() => setShowAnsiblexModal(false)}
          value={settings.ansiblexes || []}
          onChange={(list) => setSettings(s => ({ ...s, ansiblexes: list }))}
        />
      )}
      <footer>
        <small>Data: systems_index.json (client-side only)</small>
      </footer>
    </div>
  );
}

export default App;

function AnsiblexModal({ value, onChange, onClose }: { value: Array<{ from: number; to: number; enabled?: boolean }>; onChange: (v: Array<{ from: number; to: number; enabled?: boolean }>) => void; onClose: () => void }) {
  const LY = 9.4607e15; // meters per lightyear
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  // Local working list
  const [list, setList] = useState(value);
  const [copyStatus, setCopyStatus] = useState<null | 'success' | 'error'>(null);

  useEffect(() => setList(value), [value]);

  const add = () => {
    const graph: GraphData | null = (window as any).appGraph || null;
    if (!graph) return;
    const fromId = resolveQueryToId(fromQuery, graph);
    const toId = resolveQueryToId(toQuery, graph);
    if (fromId != null && toId != null) {
  setList(l => [...l, { from: fromId, to: toId, enabled: true }]);
      setFromQuery('');
      setToQuery('');
    }
  };

  const graphForNames: GraphData | null = (window as any).appGraph || null;
  const getName = (id: number) => graphForNames?.namesById?.[String(id)] ?? String(id);
  // icons rendered via <Icon /> and BASE_URL-aware filenames
  const resolvedFromId = graphForNames ? resolveQueryToId(fromQuery, graphForNames) : null;
  const resolvedToId = graphForNames ? resolveQueryToId(toQuery, graphForNames) : null;
  let distLy: number | null = null;
  let tooLong = false;
  let hasExistingFrom = false;
  let hasExistingTo = false;
  let sameEndpoints = false;
  let notNullFrom = false;
  let notNullTo = false;
  if (resolvedFromId != null && resolvedToId != null && graphForNames) {
    const a = graphForNames.systems[String(resolvedFromId)]?.position;
    const b = graphForNames.systems[String(resolvedToId)]?.position;
    if (a && b) {
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      distLy = d / LY;
      tooLong = distLy > 5;
    }
    hasExistingFrom = list.some(b => b.from === resolvedFromId || b.to === resolvedFromId);
    hasExistingTo = list.some(b => b.from === resolvedToId || b.to === resolvedToId);
    sameEndpoints = resolvedFromId === resolvedToId;
    // Nullsec check: EVE considers nullsec as security <= 0.0; low/high sec are > 0.0
    try {
      const sFrom = graphForNames.systems[String(resolvedFromId)]?.security;
      const sTo = graphForNames.systems[String(resolvedToId)]?.security;
      const secFrom = typeof sFrom === 'number' ? sFrom : 0;
      const secTo = typeof sTo === 'number' ? sTo : 0;
      notNullFrom = secFrom > 0.0;
      notNullTo = secTo > 0.0;
    } catch {}
  }
  const needsOverride = tooLong || hasExistingFrom || hasExistingTo || sameEndpoints || notNullFrom || notNullTo;

  const exportToClipboard = async () => {
    const payload = JSON.stringify(list, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus(null), 1500);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };
  const importFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      // First try JSON array import
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .map((b: any) => ({ from: Number(b.from), to: Number(b.to), enabled: true }))
            .filter((b: any) => Number.isFinite(b.from) && Number.isFinite(b.to));
          if (cleaned.length > 0) {
            setList(cleaned);
            return;
          }
        }
      } catch {}

      // Fallback: parse "The Webway" tabular format. Lines contain tokens like:
      // Region<TAB>FROM @ 1-1<TAB>TO @ 1-1<TAB>...
      const graph: GraphData | null = (window as any).appGraph || null;
      const idsByName = graph?.idsByName || {};
      const fixName = (n: string) => {
        const v = (n || '').trim().toUpperCase();
        if (v === 'TM-OP2') return 'TM-0P2';
        if (v === '07-VJ5') return 'O7-VJ5';
        return v;
      };
      const toId = (name: string): number | null => {
        const v = fixName(name);
        const id = (idsByName as any)[v];
        if (Number.isFinite(id)) return Number(id);
        if (graph) {
          const r = resolveQueryToId(v, graph);
          return Number.isFinite(r) ? Number(r) : null;
        }
        return null;
      };
      const lines = text.split(/\r?\n/);
      const pairs: Array<{ from: number; to: number; enabled: true }> = [];
      const seen = new Set<string>(); // canonical unordered key
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (/^the webway/i.test(line)) continue;
        if (/^region\b/i.test(line)) continue;
        // Extract first two occurrences of NAME @, where NAME is alnum/dash
        const matches = Array.from(line.matchAll(/([A-Z0-9-]{2,})\s*@/gi)).map(m => m[1]);
        if (matches.length >= 2) {
          const a = toId(matches[0]);
          const b = toId(matches[1]);
          if (Number.isFinite(a) && Number.isFinite(b)) {
            const from = Number(a), to = Number(b);
            const key = from < to ? `${from}-${to}` : `${to}-${from}`;
            if (!seen.has(key)) {
              seen.add(key);
              pairs.push({ from, to, enabled: true });
            }
          }
        }
      }
      if (pairs.length > 0) setList(pairs);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
  <div className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 w-auto max-w-[95vw] sm:max-w-2xl shadow-xl max-h-[85vh] flex flex-col">
        {copyStatus && (
          <div className={"pointer-events-none absolute top-2 right-3 px-3 py-1.5 rounded shadow text-sm inline-flex items-center gap-2 " + (copyStatus === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white')} role="status" aria-live="polite">
            <Icon name={copyStatus === 'success' ? 'export' : 'warn'} size={14} color="white" />
            {copyStatus === 'success' ? 'Copied!' : 'Copy failed'}
          </div>
        )}
        <h3 className="text-lg font-medium mb-3">Configure Ansiblex Bridges</h3>
          <div className="flex flex-wrap gap-2 items-center mb-2">
            <div className="w-[200px] sm:w-[220px] shrink-0">
              <AutocompleteInput compact graph={(window as any).appGraph || null} value={fromQuery} onChange={setFromQuery} placeholder="From system (name)" />
            </div>
          <span className="px-1 text-gray-600">to</span>
            <div className="w-[200px] sm:w-[220px] shrink-0">
              <AutocompleteInput compact graph={(window as any).appGraph || null} value={toQuery} onChange={setToQuery} placeholder="To system (name)" />
            </div>
          <div className="flex gap-2 items-center ml-auto flex-shrink-0 flex-wrap mt-2 sm:mt-0">
            <button
              className={'w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none disabled:opacity-50 ' + (needsOverride
                ? 'bg-orange-600 text-white hover:bg-orange-700'
                : 'bg-blue-600 text-white hover:bg-blue-700')}
              onClick={add}
              disabled={!(resolvedFromId != null && resolvedToId != null)}
              title={(() => {
                const msgs: string[] = [];
                if (tooLong && distLy != null) msgs.push(`Distance ${distLy.toFixed(1)} ly exceeds 5 ly`);
                if (sameEndpoints && resolvedFromId != null) msgs.push('From and To are the same system');
                if (hasExistingFrom && resolvedFromId != null) msgs.push(`System ${getName(resolvedFromId)} already has an Ansiblex`);
                if (hasExistingTo && resolvedToId != null && resolvedToId !== resolvedFromId) msgs.push(`System ${getName(resolvedToId)} already has an Ansiblex`);
                if (notNullFrom && resolvedFromId != null) msgs.push(`${getName(resolvedFromId)} is not nullsec (Ansiblex anchoring is nullsec-only)`);
                if (notNullTo && resolvedToId != null) msgs.push(`${getName(resolvedToId)} is not nullsec (Ansiblex anchoring is nullsec-only)`);
                return msgs.join(' • ') || 'Add bridge';
              })()}
            >
              <Icon name="plus" size={24} />
            </button>
            <button
              className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={exportToClipboard}
              title="Export bridges to clipboard"
              aria-label="Export bridges to clipboard"
            >
              <Icon name="export" size={24} />
            </button>
            <button
              className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={importFromClipboard}
              title="Import bridges from clipboard"
              aria-label="Import bridges from clipboard"
            >
              <Icon name="import" size={24} />
            </button>
          </div>
        </div>
        {tooLong && distLy != null && (
          <div className="mt-1 mb-1 text-sm text-orange-600 inline-flex items-center gap-2"><Icon name="warn" size={16} color="#ea580c" /> Warning: this Ansiblex is {distLy.toFixed(1)} ly long, which exceeds the 5 ly limit.</div>
        )}
        {sameEndpoints && (
          <div className="mt-1 mb-1 text-sm text-orange-600 inline-flex items-center gap-2"><Icon name="warn" size={16} color="#ea580c" /> Warning: From and To are the same system. This connection is invalid.</div>
        )}
        {hasExistingFrom && resolvedFromId != null && (
          <div className="mt-1 mb-1 text-sm text-orange-600 inline-flex items-center gap-2"><Icon name="warn" size={16} color="#ea580c" /> Warning: {getName(resolvedFromId)} already has an Ansiblex in this list.</div>
        )}
        {hasExistingTo && resolvedToId != null && resolvedToId !== resolvedFromId && (
          <div className="mt-1 mb-2 text-sm text-orange-600 inline-flex items-center gap-2"><Icon name="warn" size={16} color="#ea580c" /> Warning: {getName(resolvedToId)} already has an Ansiblex in this list.</div>
        )}
        {notNullFrom && resolvedFromId != null && (
          <div className="mt-1 mb-1 text-sm text-orange-600 inline-flex items-center gap-2"><Icon name="warn" size={16} color="#ea580c" /> Warning: {getName(resolvedFromId)} is not in nullsec. Ansiblex can only be anchored in nullsec.</div>
        )}
        {notNullTo && resolvedToId != null && (
          <div className="mt-1 mb-2 text-sm text-orange-600 inline-flex items-center gap-2"><Icon name="warn" size={16} color="#ea580c" /> Warning: {getName(resolvedToId)} is not in nullsec. Ansiblex can only be anchored in nullsec.</div>
        )}
        <ul className="flex-1 overflow-auto divide-y divide-gray-200 dark:divide-gray-800">
      {list.map((b, idx) => (
            <li key={idx} className="py-2 flex items-center gap-2">
              <input type="checkbox" className="accent-blue-600" checked={b.enabled !== false} onChange={(e)=> setList(ls => ls.map((x,i)=> i===idx ? { ...x, enabled: e.target.checked } : x))} />
              <span className="text-sm">{getName(b.from)} <span className="text-gray-500">⇄</span> {getName(b.to)}</span>
        <span className="ml-auto" />
              <button className="ml-2 text-xs text-red-600 hover:underline" onClick={() => setList(ls => ls.filter((_,i)=> i!==idx))}>Remove</button>
            </li>
          ))}
          {list.length === 0 && <li className="py-6 text-center text-sm text-gray-500">No Ansiblex bridges configured.</li>}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700" onClick={onClose}>Close</button>
          <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={() => { onChange(list); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
