import type { GraphData } from '../lib/data';
import { useEffect, useMemo, useRef, useState } from 'react';

export type AutocompleteItemKind = 'system' | 'constellation' | 'region' | 'alliance' | 'corporation';

export type AutocompleteItem = {
  id: number;
  name: string;
  regionName?: string;
  kind?: AutocompleteItemKind;
  meta?: string;
};

type AutocompleteCandidate = AutocompleteItem & {
  nameNorm: string;
  regionName: string;
  meta: string;
};

export function AutocompleteInput({
  graph,
  value,
  onChange,
  placeholder,
  className,
  compact,
  items,
  onSelect,
}: {
  graph: GraphData | null;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
  items?: AutocompleteItem[];
  onSelect?: (item: AutocompleteItem) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const normalize = (s: string) => s.toUpperCase().replace(/[-\s]/g, '');

  // Security color map: 0.0 or less to 1.0
  const SEC_COLORS = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];
  const secColorLabel = (id: number) => {
    try {
      const systems = graph?.systems ?? {};
      const security = systems[String(id)]?.security;
      const sVal = typeof security === 'number' ? security : 0;
      const idx = sVal <= 0 ? 0 : Math.min(10, Math.ceil(sVal * 10));
      return { color: SEC_COLORS[idx] || SEC_COLORS[0], label: sVal.toFixed(1) };
    } catch {
      return { color: SEC_COLORS[0], label: '0.0' };
    }
  };

  const candidates = useMemo<AutocompleteCandidate[]>(() => {
    // Prefer explicitly provided items
    if (Array.isArray(items)) {
      return items.map((it) => ({
        id: Number(it.id),
        name: String(it.name),
        nameNorm: normalize(String(it.name)),
        regionName: String(it.regionName ?? ''),
        kind: it.kind,
        meta: String(it.meta ?? ''),
      }));
    }
    if (!graph?.namesById) return [];
    const systems = graph.systems;
    const regionsById = graph.regionsById ?? {};
    const list = Object.entries(graph.namesById).map(([id, name]) => {
      const sys = systems[String(id)];
      const regionName = sys ? (regionsById[String(sys.regionId)] ?? String(sys.regionId)) : '';
      return {
        id: Number(id),
        name: String(name),
        nameNorm: normalize(String(name)),
        regionName,
        meta: '',
        kind: undefined,
      };
    });
    return list;
  }, [items, graph]);

  const qNorm = useMemo(() => normalize(value), [value]);

  const suggestions = useMemo(() => {
    if (!qNorm) return [] as AutocompleteCandidate[];
    const list = candidates.filter(c => c.nameNorm.includes(qNorm));
    list.sort((a, b) => {
      const ap = a.nameNorm.startsWith(qNorm) ? 0 : 1;
      const bp = b.nameNorm.startsWith(qNorm) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    if (list.some((candidate) => candidate.kind)) {
      const kindOrder: AutocompleteItemKind[] = ['system', 'constellation', 'region', 'alliance', 'corporation'];
      const perKindLimit: Record<AutocompleteItemKind, number> = {
        system: 6,
        constellation: 4,
        region: 4,
        alliance: 4,
        corporation: 4,
      };
      return kindOrder.flatMap((kind) => (
        list.filter((candidate) => candidate.kind === kind).slice(0, perKindLimit[kind])
      ));
    }
    return list.slice(0, 12);
  }, [candidates, qNorm]);

  const selectSuggestion = (suggestion: AutocompleteItem) => {
    onChange(suggestion.name);
    onSelect?.(suggestion);
    setOpen(false);
  };

  useEffect(() => {
    if (!value) setOpen(false);
  }, [value]);

  return (
    <label className={"grid gap-2 relative w-full " + (className || '')}>
      <input
        type="text"
        className={(compact ? 'px-2 py-1 text-sm ' : 'px-3 py-2 text-base ') + 'block w-full min-w-0 rounded-md border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900'}
        placeholder={placeholder}
        value={value}
        ref={inputRef}
        onFocus={() => { if (value) setOpen(true); }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={(e) => {
          if (!suggestions.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setHighlight(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { if (open) { e.preventDefault(); const s = suggestions[highlight]; if (s) selectSuggestion(s); } }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        onBlur={() => { setTimeout(() => setOpen(false), 120); }}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow">
          {suggestions.map((s, idx) => {
            const previousKind = idx > 0 ? suggestions[idx - 1].kind : undefined;
            const showGroupLabel = s.kind && s.kind !== previousKind;
            const security = !s.kind || s.kind === 'system' ? secColorLabel(s.id) : null;
            return (
              <li key={`${s.kind ?? 'item'}-${s.id}`}>
                {showGroupLabel && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {s.kind === 'corporation' ? 'Corporations' : `${s.kind}s`}
                  </div>
                )}
                <div
                  className={(idx === highlight ? 'bg-blue-600 text-white ' : 'hover:bg-gray-100 dark:hover:bg-gray-800 ') + 'px-3 py-1.5 text-sm cursor-pointer flex items-center justify-between gap-3'}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{s.name}</span>
                    {security && <span style={{ color: security.color, fontWeight: 700 }}>{security.label}</span>}
                    {s.kind && (
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                        idx === highlight
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}>
                        {s.kind === 'constellation' ? 'const.' : s.kind === 'corporation' ? 'corp' : s.kind}
                      </span>
                    )}
                  </span>
                  <span className={`ml-3 shrink-0 text-xs ${
                    idx === highlight ? 'text-white/75' : 'text-gray-500 dark:text-gray-400'
                  }`}>
                    {s.meta || s.regionName}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </label>
  );
}
