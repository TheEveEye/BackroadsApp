import { useEffect, useMemo, useState } from 'react';
import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { Icon } from './Icon';
import { AutocompleteInput } from './AutocompleteInput';
import { ConfirmDialog } from './ConfirmDialog';

export function AnsiblexModal({ value, onChange, onClose }: { value: Array<{ from: number; to: number; enabled?: boolean }>; onChange: (v: Array<{ from: number; to: number; enabled?: boolean }>) => void; onClose: () => void }) {
  const LY = 9.4607e15; // meters per lightyear
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  // Local working list
  const [list, setList] = useState(value);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

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

  const hasUnsaved = useMemo(() => {
    try {
      return JSON.stringify(value) !== JSON.stringify(list);
    } catch {
      return true;
    }
  }, [value, list]);

  const attemptClose = () => {
    if (hasUnsaved) setShowUnsavedConfirm(true);
    else onClose();
  };

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showUnsavedConfirm) return; // let nested dialog handle it
        e.preventDefault();
        attemptClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasUnsaved, showUnsavedConfirm]);

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
    } catch {}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50">
      <div className="w-full max-w-[600px] max-h-[85vh] overflow-visible rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Configure Ansiblex Bridges</h2>
          <button className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800" onClick={attemptClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 grid grid-cols-2 gap-2 items-center">
            <AutocompleteInput compact graph={(window as any).appGraph || null} value={fromQuery} onChange={setFromQuery} placeholder="From system (name)" />
            <AutocompleteInput compact graph={(window as any).appGraph || null} value={toQuery} onChange={setToQuery} placeholder="To system (name)" />
          </div>
          <div className="flex items-center gap-2">
            <button
              className={"w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border " + (needsOverride
                ? 'border-orange-300 text-orange-700 bg-orange-100 hover:bg-orange-200 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/20 hover:bg-orange-200'
                : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800')}
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
              <button className="ml-2 mr-2 text-xs text-red-600 hover:underline" onClick={() => setList(ls => ls.filter((_,i)=> i!==idx))}>Remove</button>
            </li>
          ))}
          {list.length === 0 && <li className="py-6 text-center text-sm text-gray-500">No Ansiblex bridges configured.</li>}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700" onClick={attemptClose}>Close</button>
          <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={() => { onChange(list); onClose(); }}>Save</button>
        </div>
      </div>
      {showUnsavedConfirm && (
        <ConfirmDialog
          open={showUnsavedConfirm}
          title="Discard changes?"
          message="You have unsaved changes. Do you want to discard them?"
          confirmLabel="Discard"
          cancelLabel="Cancel"
          tone="warn"
          onCancel={() => setShowUnsavedConfirm(false)}
          onConfirm={() => { setShowUnsavedConfirm(false); onClose(); }}
        />
      )}
    </div>
  );
}
