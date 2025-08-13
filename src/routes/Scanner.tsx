import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { GraphData } from '../lib/data';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { Icon } from '../components/Icon';

type WormholeType = 'Conflux' | 'Barbican' | 'Redoubt' | 'Sentinel' | 'Vidette';

type Wormhole = {
  id: string;
  systemId: number | null;
  systemName: string;
  type: WormholeType | null;
  eol: boolean;
  reduced: boolean;
  critical: boolean;
};

export function Scanner() {
  const graph: GraphData | null = (window as any).appGraph || null;
  const [wormholes, setWormholes] = useState<Wormhole[]>([]);
  const [copyStatus, setCopyStatus] = useState<null | 'success' | 'error'>(null);
  const location = useLocation();

  const TYPE_TO_CODE: Record<WormholeType, string> = {
    Conflux: 'C',
    Barbican: 'B',
    Redoubt: 'R',
    Sentinel: 'S',
    Vidette: 'V',
  };
  const CODE_TO_TYPE: Record<string, WormholeType> = {
    C: 'Conflux',
    B: 'Barbican',
    R: 'Redoubt',
    S: 'Sentinel',
    V: 'Vidette',
  };

  const packFlags = (wh: Wormhole) => (wh.eol ? 1 : 0) | (wh.reduced ? 2 : 0) | (wh.critical ? 4 : 0);
  const unpackFlags = (n: number) => ({ eol: !!(n & 1), reduced: !!(n & 2), critical: !!(n & 4) });

  function buildCompact(list: Wormhole[]) {
    // Compact representation: [ref, code, flags]
    // ref is number systemId if available, else string systemName
    return list.map(wh => [wh.systemId ?? wh.systemName, wh.type ? TYPE_TO_CODE[wh.type] : '', packFlags(wh)]);
  }
  function expandCompact(compact: any): Wormhole[] {
    if (!Array.isArray(compact)) return [];
    const namesById: any = (graph as any)?.namesById || {};
    const out: Wormhole[] = [];
    for (const entry of compact) {
      if (!Array.isArray(entry)) continue;
      const [ref, code, flags] = entry as [number | string, string, number];
      let systemId: number | null = null;
      let systemName = '';
  if (typeof ref === 'number' && Number.isFinite(ref)) {
        systemId = Number(ref);
        systemName = String(namesById[String(systemId)] ?? '');
      } else if (typeof ref === 'string') {
        systemName = ref;
      }
      const type = code && CODE_TO_TYPE[code] ? CODE_TO_TYPE[code] : null;
      const { eol, reduced, critical } = unpackFlags(Number(flags) || 0);
      out.push({ id: crypto.randomUUID(), systemId, systemName, type, eol, reduced, critical });
    }
    return out;
  }

  // Load from URL (?wh=base64) on mount and whenever search changes (e.g., link opened)
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const wh = params.get('wh');
      if (wh) {
        const json = atob(wh);
        const parsed = JSON.parse(json);
        const list = expandCompact(parsed);
        if (list.length) setWormholes(list);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // When the graph becomes available later, fill in missing system names for items with systemId
  useEffect(() => {
    const fillNames = () => {
      const g: GraphData | null = (window as any).appGraph || null;
      if (!g) return;
      const namesById: any = (g as any).namesById || {};
      setWormholes(list => list.map(wh => {
        if (wh.systemId != null && (!wh.systemName || wh.systemName.length === 0)) {
          const nm = String(namesById[String(wh.systemId)] ?? wh.systemName);
          return { ...wh, systemName: nm };
        }
        return wh;
      }));
    };
    fillNames();
    const onLoaded = () => fillNames();
    window.addEventListener('graph-loaded', onLoaded as any);
    return () => window.removeEventListener('graph-loaded', onLoaded as any);
  }, []);

  const addNew = () => {
    setWormholes(list => [
      ...list,
      { id: crypto.randomUUID(), systemId: null, systemName: '', type: null, eol: false, reduced: false, critical: false },
    ]);
  };

  const hasObservatory = (id: number) => {
    try { return !!graph?.systems[String(id)]?.hasObservatory; } catch { return false; }
  };

  const observatoryItems = useMemo(() => {
    if (!graph) return [] as Array<{ id: number; name: string; regionName?: string }>;
    const systems: any = (graph as any).systems || {};
    const namesById: any = (graph as any).namesById || {};
    const regionsById: any = (graph as any).regionsById || {};
    const list: Array<{ id: number; name: string; regionName?: string }> = [];
    for (const [idStr, sys] of Object.entries(systems)) {
      const id = Number(idStr);
      if (!Number.isFinite(id)) continue;
      const s: any = sys as any;
      if (!s || !s.hasObservatory) continue;
      const name = String(namesById[idStr] ?? idStr);
      const regionName = String(regionsById[String(s.regionId)] ?? s.regionId ?? '');
      list.push({ id, name, regionName });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [graph]);

  const norm = (s: string) => s.toUpperCase().replace(/[-\s]/g, '');

  const handleCopyDiscord = async () => {
    const now = Math.floor(Date.now() / 1000);
    const regionsById: any = (graph as any)?.regionsById || {};
    const systems: any = (graph as any)?.systems || {};
    const namesById: any = (graph as any)?.namesById || {};

    // group valid entries by region name
    const groups = new Map<string, Array<{ name: string; type: WormholeType; eol: boolean; reduced: boolean; critical: boolean }>>();
    for (const wh of wormholes) {
      if (!wh.systemId || !wh.type) continue;
      const sys = systems[String(wh.systemId)];
      if (!sys) continue;
      const regionName = String(regionsById[String(sys.regionId)] ?? sys.regionId ?? '');
      const systemName = String(namesById[String(wh.systemId)] ?? wh.systemName ?? wh.systemId);
      const arr = groups.get(regionName) || [];
      arr.push({ name: systemName, type: wh.type, eol: !!wh.eol, reduced: !!wh.reduced, critical: !!wh.critical });
      groups.set(regionName, arr);
    }

    // build lines
    const lines: string[] = [];
    // Build a share link for the current wormholes and linkify the heading text
    try {
      const compact = buildCompact(wormholes);
      const b64 = btoa(JSON.stringify(compact));
      const base = `${window.location.origin}${window.location.pathname}#/scanner`;
      const url = `${base}?wh=${encodeURIComponent(b64)}`;
      lines.push(`## [Scan was completed <t:${now}:R>](${url})`);
    } catch {
      lines.push(`## Scan was completed <t:${now}:R>`);
    }
    const regionNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
    for (const rn of regionNames) {
      lines.push(`## ${rn}`);
      const entries = (groups.get(rn) || []).sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        const life = e.eol ? '*@eol*' : '*Fresh*';
        const mass = e.critical ? '*@Crit*' : e.reduced ? '*@Reduced*' : '*Stable*';
        lines.push(`**${e.name}** => ***@${e.type}***, **Life:**  ${life}, **Mass:**  ${mass}`);
      }
      // blank line between regions for readability
      lines.push('');
    }

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus(null), 1500);
    } catch (_) {
      // fallback: create a temporary textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      } finally {
        document.body.removeChild(ta);
      }
      setCopyStatus(ok ? 'success' : 'error');
      setTimeout(() => setCopyStatus(null), ok ? 1500 : 2000);
    }
  };

  const handleCopyLink = async () => {
    try {
      const compact = buildCompact(wormholes);
      const b64 = btoa(JSON.stringify(compact));
      const base = `${window.location.origin}${window.location.pathname}#/scanner`;
      const url = `${base}?wh=${encodeURIComponent(b64)}`;
      await navigator.clipboard.writeText(url);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus(null), 1500);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  return (
    <section className="grid gap-6">
      <div className="flex items-center">
        <h1 className="text-2xl font-semibold">Scanner</h1>
      </div>

      {wormholes.length === 0 && (
        <p className="text-slate-600 dark:text-slate-300">No wormholes yet. Click "New Wormhole" to add one.</p>
      )}

      <ul className="grid gap-4">
        {wormholes.map((wh, idx) => (
          <li key={wh.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-4">
            <div className="grid md:grid-cols-4 gap-4 items-start">
              <div>
                <div className="font-semibold mb-2">Solar System</div>
                <AutocompleteInput
                  graph={graph}
                  value={wh.systemName}
                  onChange={(v) => {
                    const idFromMap = graph?.idsByName ? graph.idsByName[norm(v)] : undefined;
                    const matchId = (typeof idFromMap === 'number' && hasObservatory(idFromMap)) ? idFromMap : null;
                    setWormholes(list => list.map((x,i)=> i===idx ? { ...x, systemName: v, systemId: matchId } : x));
                  }}
                  placeholder="Select…"
                  className="max-w-xs"
                  items={observatoryItems}
                />
                <button className="mt-3 px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600" onClick={() => setWormholes(list => list.filter((_,i)=> i!==idx))}>Remove</button>
              </div>
              <div>
                <div className="font-semibold mb-2">Wormhole Type</div>
                <div className="flex flex-wrap gap-3 items-center">
                  {(['Conflux','Barbican','Redoubt','Sentinel','Vidette'] as WormholeType[]).map(t => (
                    <label key={t} className="inline-flex items-center gap-1">
                      <input type="radio" name={`t-${wh.id}`} checked={wh.type===t} onChange={()=> setWormholes(list => list.map((x,i)=> i===idx ? { ...x, type: t } : x))} />
                      <span>{t[0]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-semibold mb-2">End of Life?</div>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={wh.eol} onChange={(e)=> setWormholes(list => list.map((x,i)=> i===idx ? { ...x, eol: e.target.checked } : x))} />
                  <span>EoL</span>
                </label>
              </div>
              <div>
                <div className="font-semibold mb-2">Mass</div>
                <div className="flex gap-4">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wh.reduced}
                      onChange={(e)=> setWormholes(list => list.map((x,i)=> {
                        if (i !== idx) return x;
                        const checked = e.target.checked;
                        // Reduced and Crit are mutually exclusive; uncheck Crit when Reduced is checked
                        return { ...x, reduced: checked, critical: checked ? false : x.critical };
                      }))}
                    />
                    <span>Reduced</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wh.critical}
                      onChange={(e)=> setWormholes(list => list.map((x,i)=> {
                        if (i !== idx) return x;
                        const checked = e.target.checked;
                        // Crit and Reduced are mutually exclusive; uncheck Reduced when Crit is checked
                        return { ...x, critical: checked, reduced: checked ? false : x.reduced };
                      }))}
                    />
                    <span>Crit</span>
                  </label>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="relative flex items-center">
        {copyStatus && (
          <div className={"pointer-events-none absolute -top-8 right-0 px-3 py-1.5 rounded shadow text-sm inline-flex items-center gap-2 " + (copyStatus === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white')} role="status" aria-live="polite">
            <Icon name={copyStatus === 'success' ? 'export' : 'warn'} size={14} color="white" />
            {copyStatus === 'success' ? 'Copied!' : 'Copy failed'}
          </div>
        )}
        <div className="flex-1 flex justify-center">
          <button onClick={addNew} className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">New Wormhole</button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleCopyDiscord} className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800" aria-label="Discord">
            <Icon name="discord" size={20} />
          </button>
          <button type="button" onClick={handleCopyLink} className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800" aria-label="Link">
            <Icon name="link" size={20} />
          </button>
        </div>
      </div>
    </section>
  );
}
