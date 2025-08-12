import type { GraphData } from '../lib/data';
import { resolveQueryToId } from '../lib/graph';
import { useEffect } from 'react';
import { AutocompleteInput } from './AutocompleteInput';
import { Icon } from './Icon';

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
  settings: { excludeZarzakh: boolean; sameRegionOnly: boolean; titanBridgeFirstJump: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; bidirectional?: boolean; enabled?: boolean }>; };
  setSettings: (s: { excludeZarzakh: boolean; sameRegionOnly: boolean; titanBridgeFirstJump: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; bidirectional?: boolean; enabled?: boolean }>; }) => void;
}) {
  // Autocomplete state
  // no-op

  // Autocomplete handled by AutocompleteInput component

  // Build candidate list: id, name, normalized name, region name
  // candidates and query normalization are handled inside AutocompleteInput

  // suggestions handled by AutocompleteInput

  // Keep startId in sync with query
  useEffect(() => {
    if (!graph) return;
    const id = resolveQueryToId(query, graph);
    onStartId(id);
  }, [query, graph, onStartId]);

  return (
    <section className="grid gap-4 grid-cols-1 md:grid-cols-2 bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <label className="grid gap-2">
        Start system (name):
        <AutocompleteInput graph={graph} value={query} onChange={setQuery} placeholder="e.g. Jita" />
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
          <input type="checkbox" className="accent-blue-600" checked={settings.excludeZarzakh} onChange={(e)=> setSettings({ ...settings, excludeZarzakh: e.target.checked })} />
          <span>Exclude Zarzakh</span>
        </label>
      
        <label className="inline-flex items-center gap-2 mr-4">
          <input type="checkbox" className="accent-blue-600" checked={settings.sameRegionOnly} onChange={(e)=> setSettings({ ...settings, sameRegionOnly: e.target.checked })} />
          <span>Only show systems in same region</span>
        </label>

        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="accent-blue-600" checked={settings.titanBridgeFirstJump} onChange={(e)=> setSettings({ ...settings, titanBridgeFirstJump: e.target.checked })} />
          <span>Count Titan bridge from start as first jump</span>
        </label>

        <div className="mt-3 flex items-center gap-3">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="accent-blue-600" checked={!!settings.allowAnsiblex} onChange={(e)=> setSettings({ ...settings, allowAnsiblex: e.target.checked })} />
            <span>Allow Ansiblex jump bridges</span>
          </label>
          <button type="button" className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center justify-center gap-1 leading-none" onClick={() => {
            // Placeholder for opening modal; actual modal implemented in App
            const ev = new CustomEvent('open-ansiblex-modal');
            window.dispatchEvent(ev);
          }}>
            <Icon name="gear" size={16} />
            <span className="inline-block align-middle">Configure…</span>
          </button>
        </div>
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
