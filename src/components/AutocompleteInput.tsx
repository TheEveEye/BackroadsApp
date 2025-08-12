import type { GraphData } from '../lib/data';
import { useEffect, useMemo, useRef, useState } from 'react';

export function AutocompleteInput({
  graph,
  value,
  onChange,
  placeholder,
  className,
  compact,
}: {
  graph: GraphData | null;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const normalize = (s: string) => s.toLowerCase().replace(/[-\s]/g, '');

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

  const qNorm = useMemo(() => normalize(value), [value]);

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

  useEffect(() => {
    if (!value) setOpen(false);
  }, [value]);

  return (
    <label className={"grid gap-2 relative " + (className || '')}>
      <input
        type="text"
        className={(compact ? 'px-2 py-1 text-sm ' : 'px-3 py-2 text-base ') + 'rounded-md border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900'}
        placeholder={placeholder}
        value={value}
        ref={inputRef}
        onFocus={() => { if (value) setOpen(true); }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={(e) => {
          if (!suggestions.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setHighlight(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { if (open) { e.preventDefault(); const s = suggestions[highlight]; if (s) { onChange(s.name); setOpen(false); } } }
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
              onMouseDown={(e) => { e.preventDefault(); onChange(s.name); setOpen(false); }}
            >
              <span>{s.name}</span>
              <span className="text-gray-500 dark:text-gray-400 ml-3">{s.regionName}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
