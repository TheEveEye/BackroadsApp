import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { useEffect, useMemo, useRef, useState } from 'react';

export function SearchForm({
  query,
  settings,
  setSettings,
  setQuery,
  maxJumps,
  setMaxJumps,
  lyRadius,
  setLyRadius,
  graph,
  onStartId,
}: {
  query: string;
  setQuery: (v: string) => void;
  maxJumps: number;
  setMaxJumps: (v: number) => void;
  lyRadius: number;
  setLyRadius: (v: number) => void;
  graph: GraphData | null;
  onStartId: (id: number | null) => void;
  settings: { excludeZarzakh: boolean };
  setSettings: (s: { excludeZarzakh: boolean }) => void;
}) {
  // Autocomplete state
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Normalize by lowercasing and removing dashes/spaces
  const normalize = (s: string) => s.toLowerCase().replace(/[-\s]/g, '');

  // Build candidate list: id, name, normalized name, region name
  const candidates = useMemo(() => {
    if (!graph?.namesById) return [] as Array<{ id: number; name: string; nameNorm: string; regionName: string }>;
    const systems: any = (graph as any).systems || {};
    const regionsById: any = (graph as any).regionsById || {};
    return Object.entries(graph.namesById).map(([id, name]) => {
      const sys = systems[String(id)];
      const regionName = sys ? (regionsById[String(sys.regionId)] ?? String(sys.regionId)) : '';
      return { id: Number(id), name: String(name), nameNorm: normalize(String(name)), regionName };
    });
  }, [graph]);

  const qNorm = useMemo(() => normalize(query), [query]);

  const suggestions = useMemo(() => {
    if (!qNorm) return [] as Array<{ id: number; name: string; nameNorm: string; regionName: string }>;
    const list = candidates.filter(c => c.nameNorm.includes(qNorm));
    list.sort((a, b) => {
      const ap = a.nameNorm.startsWith(qNorm) ? 0 : 1;
      const bp = b.nameNorm.startsWith(qNorm) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    return list.slice(0, 12);
  }, [candidates, qNorm]);

  // Keep startId in sync with query
  useEffect(() => {
    if (!graph) return;
    const id = resolveQueryToId(query, graph);
    onStartId(id);
  }, [query, graph, onStartId]);

  return (
    <section className="grid gap-4 grid-cols-1 md:grid-cols-2 bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <label className="grid gap-2 relative">
        Start system (name):
        <input
          type="text"
          className="px-3 py-2 text-base rounded-md border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900"
          placeholder='e.g. Jita'
          value={query}
          ref={inputRef}
          onFocus={() => { if (query) setOpen(true); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={(e) => {
            if (!suggestions.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setHighlight(h => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { if (open) { e.preventDefault(); const s = suggestions[highlight]; if (s) { setQuery(s.name); setOpen(false); } } }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
          onBlur={() => { setTimeout(() => setOpen(false), 120); }}
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow">
            {suggestions.map((s, idx) => (
              <li
                key={s.id}
                className={(idx === highlight ? 'bg-blue-600 text-white ' : 'hover:bg-gray-100 dark:hover:bg-gray-800 ') + 'px-3 py-1.5 text-sm cursor-pointer flex justify-between'}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); setQuery(s.name); setOpen(false); }}
              >
                <span>{s.name}</span>
                <span className="text-gray-500 dark:text-gray-400 ml-3">{s.regionName}</span>
              </li>
            ))}
          </ul>
        )}
      </label>

      <label className="grid gap-2">
        Max jumps: {maxJumps}
        <input
          type="range" className="accent-blue-600 w-full"
          min={0}
          max={20}
          step={1}
          value={maxJumps}
          onChange={(e) => setMaxJumps(Number(e.target.value))}
        />
      </label>

      <fieldset className="md:col-span-2 border border-gray-200 dark:border-gray-700 rounded-md p-3">
        <legend className="px-1 text-sm text-gray-700 dark:text-gray-300">Settings</legend>
        <label className="inline-flex items-center gap-2 mr-4">
          <input type="checkbox" className="accent-blue-600" checked={settings.excludeZarzakh} onChange={(e)=> setSettings({ excludeZarzakh: e.target.checked })} />
          <span>Exclude Zarzakh</span>
        </label>
      </fieldset>

      <label className="grid gap-2 md:col-span-2">
        Distance radius (lightyears): {lyRadius.toFixed(1)} ly
        <input
          type="range" className="accent-blue-600 w-full"
          min={0}
          max={50}
          step={0.5}
          value={lyRadius}
          onChange={(e) => setLyRadius(Number(e.target.value))}
        />
      </label>
    </section>
  );
}
