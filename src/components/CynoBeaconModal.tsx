import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { AutocompleteInput } from './AutocompleteInput';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { ModalShell } from './ModalShell';

export type CynoBeaconEntry = { id: number; enabled?: boolean };

const EXPORT_TITLE = 'Backroads Cyno Beacons';
const EXPORT_HEADER = 'System\tNotes\tStation\tOffline';
type AppWindow = Window & typeof globalThis & { appGraph?: GraphData | null };

function normalizeImportRow(raw: string) {
  if (raw.includes('\t')) return raw.split('\t');
  return raw.split(/\s{2,}/);
}

export function CynoBeaconModal({
  value,
  onChange,
  onClose,
}: {
  value: CynoBeaconEntry[];
  onChange: (v: CynoBeaconEntry[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<CynoBeaconEntry[]>(value);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  useEffect(() => setList(value), [value]);

  const graphForNames: GraphData | null = (window as AppWindow).appGraph || null;
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

  const attemptClose = useCallback(() => {
    if (hasUnsaved) setShowUnsavedConfirm(true);
    else onClose();
  }, [hasUnsaved, onClose]);

  const exportToClipboard = async () => {
    const lines = [
      EXPORT_TITLE,
      EXPORT_HEADER,
      ...list.map((item) => `${getName(item.id)}\t\tNo\t${item.enabled === false ? 'Yes' : 'No'}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
      // Ignore clipboard failures.
    }
  };

  const importFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();

      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) {
          const seen = new Set<number>();
          const cleaned = parsed
            .map((item) => {
              const record = item as Partial<CynoBeaconEntry>;
              return {
                id: Number(record.id),
                enabled: record.enabled === false ? false : true,
              };
            })
            .filter((item: CynoBeaconEntry) => Number.isFinite(item.id) && !seen.has(item.id) && (seen.add(item.id), true));
          if (cleaned.length > 0) {
            setList(cleaned);
            return;
          }
        }
      } catch {
        // Fall back to tabular import parsing.
      }

      const graph: GraphData | null = (window as AppWindow).appGraph || null;
      const idsByName = graph?.idsByName || {};
      const toId = (name: string): number | null => {
        const trimmed = (name || '').trim();
        if (!trimmed) return null;
        const key = trimmed.toUpperCase().replace(/[-\s]/g, '');
        const id = (idsByName as Record<string, number>)[key];
        if (typeof id === 'number' && Number.isFinite(id)) return id;
        if (!graph) return null;
        const resolved = resolveQueryToId(trimmed, graph);
        return Number.isFinite(resolved) ? Number(resolved) : null;
      };

      const seen = new Set<number>();
      const imported: CynoBeaconEntry[] = [];
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^the beacons of /i.test(line)) continue;
        if (/^backroads cyno beacons$/i.test(line)) continue;
        const columns = normalizeImportRow(rawLine);
        if (columns.length === 0) continue;
        const systemName = (columns[0] || '').trim();
        if (!systemName || /^system$/i.test(systemName)) continue;
        const id = toId(systemName);
        if (id == null || seen.has(id)) continue;
        seen.add(id);
        const offlineValue = (columns[3] || '').trim().toLowerCase();
        imported.push({ id, enabled: offlineValue !== 'yes' });
      }

      if (imported.length > 0) setList(imported);
    } catch {
      // Ignore clipboard failures.
    }
  };

  return (
    <ModalShell
      onClose={attemptClose}
      closeOnEscape={!showUnsavedConfirm}
      panelClassName="w-full max-w-[520px] max-h-[85vh] overflow-visible rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 flex flex-col"
      labelledBy="cyno-beacon-modal-title"
    >
        <div className="flex items-center justify-between mb-3">
          <h2 id="cyno-beacon-modal-title" className="text-lg font-semibold">Configure Cyno Beacons</h2>
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
            <AutocompleteInput compact graph={graphForNames} value={query} onChange={setQuery} placeholder="Beacon system" />
          </div>
          <button
            className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            onClick={add}
            disabled={resolvedId == null || hasExisting}
            title={hasExisting ? 'System already in beacon list' : 'Add beacon'}
          >
            <Icon name="plus" size={24} />
          </button>
          <button
            className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={exportToClipboard}
            title="Export beacons to clipboard"
            aria-label="Export beacons to clipboard"
          >
            <Icon name="export" size={24} />
          </button>
          <button
            className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={importFromClipboard}
            title="Import beacons from clipboard"
            aria-label="Import beacons from clipboard"
          >
            <Icon name="import" size={24} />
          </button>
        </div>
        {hasExisting && resolvedId != null && (
          <div className="mt-1 mb-2 text-sm text-orange-600 inline-flex items-center gap-2">
            <Icon name="warn" size={16} color="#ea580c" /> {getName(resolvedId)} is already in the beacon list.
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
            <li className="py-6 text-center text-sm text-gray-500">No cyno beacons configured.</li>
          )}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700" onClick={attemptClose}>Close</button>
          <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={() => { onChange(list); onClose(); }}>Save</button>
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
    </ModalShell>
  );
}
