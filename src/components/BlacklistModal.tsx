import { useEffect, useMemo, useState } from 'react';
import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { AutocompleteInput } from './AutocompleteInput';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

export type BlacklistEntry = { id: number; enabled?: boolean };

export function BlacklistModal({
  value,
  onChange,
  onClose,
}: {
  value: BlacklistEntry[];
  onChange: (v: BlacklistEntry[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<BlacklistEntry[]>(value);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  useEffect(() => setList(value), [value]);

  const graphForNames: GraphData | null = (window as any).appGraph || null;
  const resolvedId = graphForNames ? resolveQueryToId(query, graphForNames) : null;
  const getName = (id: number) => graphForNames?.namesById?.[String(id)] ?? String(id);
  const hasExisting = resolvedId != null && list.some((item) => item.id === resolvedId);

  const add = () => {
    if (resolvedId == null || hasExisting) return;
    setList((l) => [...l, { id: resolvedId, enabled: true }]);
    setQuery('');
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showUnsavedConfirm) return;
        e.preventDefault();
        attemptClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasUnsaved, showUnsavedConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50">
      <div className="w-full max-w-[480px] max-h-[85vh] overflow-visible rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Blacklist Systems</h2>
          <button
            className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={attemptClose}
            aria-label="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1">
            <AutocompleteInput compact graph={graphForNames} value={query} onChange={setQuery} placeholder="System to blacklist" />
          </div>
          <button
            className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            onClick={add}
            disabled={resolvedId == null || hasExisting}
            title={hasExisting ? 'System already in blacklist' : 'Add system'}
          >
            <Icon name="plus" size={24} />
          </button>
        </div>
        {hasExisting && resolvedId != null && (
          <div className="mt-1 mb-2 text-sm text-orange-600 inline-flex items-center gap-2">
            <Icon name="warn" size={16} color="#ea580c" /> {getName(resolvedId)} is already in the blacklist.
          </div>
        )}
        <ul className="flex-1 overflow-auto divide-y divide-gray-200 dark:divide-gray-800">
          {list.map((item, idx) => (
            <li key={`${item.id}-${idx}`} className="py-2 flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={item.enabled !== false}
                onChange={(e) => setList((ls) => ls.map((entry, i) => (i === idx ? { ...entry, enabled: e.target.checked } : entry)))}
              />
              <span className="text-sm">{getName(item.id)}</span>
              <span className="ml-auto" />
              <button
                className="ml-2 mr-2 text-xs text-red-600 hover:underline"
                onClick={() => setList((ls) => ls.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-6 text-center text-sm text-gray-500">No blacklisted systems configured.</li>
          )}
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
