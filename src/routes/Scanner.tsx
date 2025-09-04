import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { GraphData } from '../lib/data';
import { resolveQueryToId, findPathTo } from '../lib/graph';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { Icon } from '../components/Icon';
import { AnsiblexModal as SharedAnsiblexModal } from '../components/AnsiblexModal';
import { ConfirmDialog } from '../components/ConfirmDialog';

type WormholeType = 'Conflux' | 'Barbican' | 'Redoubt' | 'Sentinel' | 'Vidette';

type Wormhole = {
  id: string;
  systemId: number | null;
  systemName: string;
  type: WormholeType | null;
  eol: boolean;
  reduced: boolean;
  critical: boolean;
  bookmarkInside: boolean;
  bookmarkOutside: boolean;
};

export function Scanner() {
  const graph: GraphData | null = (window as any).appGraph || null;
  // Route selection panel state (start/destination and settings)
  const ROUTE_UI_KEY = 'br.scanner.ui.v1';
  const SETTINGS_STORAGE_KEY = 'br.settings.v1';
  const [route, setRoute] = useState<{ fromQuery: string; toQuery: string }>(() => {
    try {
      const raw = localStorage.getItem(ROUTE_UI_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            fromQuery: typeof parsed.fromQuery === 'string' ? parsed.fromQuery : '',
            toQuery: typeof parsed.toQuery === 'string' ? parsed.toQuery : '',
          };
        }
      }
    } catch {}
    return { fromQuery: '', toQuery: '' };
  });
  const [settings, setSettings] = useState<{ excludeZarzakh: boolean; sameRegionOnly: boolean; titanBridgeFirstJump: boolean; allowAnsiblex?: boolean; ansiblexes?: Array<{ from: number; to: number; enabled?: boolean }> }>(() => {
    const defaults = { excludeZarzakh: true, sameRegionOnly: false, titanBridgeFirstJump: false, allowAnsiblex: false, ansiblexes: [] as Array<{ from: number; to: number; enabled?: boolean }> };
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
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

  // flags bitmask:
  // 1: eol, 2: reduced, 4: critical, 8: bookmarkInside, 16: bookmarkOutside
  const packFlags = (wh: Wormhole) =>
    (wh.eol ? 1 : 0) |
    (wh.reduced ? 2 : 0) |
    (wh.critical ? 4 : 0) |
    (wh.bookmarkInside ? 8 : 0) |
    (wh.bookmarkOutside ? 16 : 0);
  const unpackFlags = (n: number) => ({
    eol: !!(n & 1),
    reduced: !!(n & 2),
    critical: !!(n & 4),
    bookmarkInside: !!(n & 8),
    bookmarkOutside: !!(n & 16),
  });

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
  const { eol, reduced, critical, bookmarkInside, bookmarkOutside } = unpackFlags(Number(flags) || 0);
  out.push({ id: crypto.randomUUID(), systemId, systemName, type, eol, reduced, critical, bookmarkInside, bookmarkOutside });
    }
    return out;
  }

  // Load from URL (?wh=base64&from=...&to=...) on mount and whenever search changes (e.g., link opened)
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
      const f = params.get('from');
      const t = params.get('to');
      if (typeof f === 'string' || typeof t === 'string') {
        setRoute(r => ({
          fromQuery: typeof f === 'string' ? f : r.fromQuery,
          toQuery: typeof t === 'string' ? t : r.toQuery,
        }));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Persist route inputs
  useEffect(() => {
    try {
      localStorage.setItem(ROUTE_UI_KEY, JSON.stringify(route));
    } catch {}
  }, [route]);

  // Derive numeric IDs from start/destination queries
  const fromId = useMemo(() => (graph ? resolveQueryToId(route.fromQuery, graph) : null), [graph, route.fromQuery]);
  const toId = useMemo(() => (graph ? resolveQueryToId(route.toQuery, graph) : null), [graph, route.toQuery]);

  // Direct gates-only route between selected start and destination (no titan, no Ansiblex)
  const directGatePath = useMemo(() => {
    if (!graph || fromId == null || toId == null) return null;
    try {
      const res = findPathTo({
        startId: fromId,
        targetId: toId,
        maxJumps: 200,
        graph,
        settings: {
          excludeZarzakh: !!settings.excludeZarzakh,
          sameRegionOnly: !!settings.sameRegionOnly,
          titanBridgeFirstJump: !!settings.titanBridgeFirstJump,
          allowAnsiblex: !!settings.allowAnsiblex,
          ansiblexes: settings.ansiblexes || [],
        },
        lyRadius: settings.titanBridgeFirstJump ? 6 : 0,
      });
      return res.path;
    } catch {
      return null;
    }
  }, [graph, fromId, toId, settings.excludeZarzakh, settings.sameRegionOnly, settings.titanBridgeFirstJump, settings.allowAnsiblex, settings.ansiblexes]);

  // Open modal when any component dispatches the global event
  useEffect(() => {
    const onOpen = () => setShowAnsiblexModal(true);
    window.addEventListener('open-ansiblex-modal', onOpen as any);
    return () => window.removeEventListener('open-ansiblex-modal', onOpen as any);
  }, []);

  // Persist settings and ansiblex list consistently with observatory page
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);
  useEffect(() => {
    try { localStorage.setItem('br.ansiblex.v1', JSON.stringify(settings.ansiblexes || [])); } catch {}
  }, [settings.ansiblexes]);

  const doClearAll = () => {
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      localStorage.removeItem('br.ansiblex.v1');
      localStorage.removeItem(ROUTE_UI_KEY);
    } catch {}
    setSettings({ excludeZarzakh: true, sameRegionOnly: false, titanBridgeFirstJump: false, allowAnsiblex: false, ansiblexes: [] });
    setRoute({ fromQuery: '', toQuery: '' });
  };

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
  { id: crypto.randomUUID(), systemId: null, systemName: '', type: null, eol: false, reduced: false, critical: false, bookmarkInside: false, bookmarkOutside: false },
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
      const basePath = ((import.meta as any).env?.BASE_URL || '/');
      const base = `${window.location.origin}${basePath}scanner`;
      const url = `${base}?wh=${encodeURIComponent(b64)}&from=${encodeURIComponent(route.fromQuery || '')}&to=${encodeURIComponent(route.toQuery || '')}`;
      lines.push(`## [Scan was completed <t:${now}:R>](${url})`);
    } catch {
      lines.push(`## Scan was completed <t:${now}:R>`);
    }
    const regionNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
    if (regionNames.length) {
      lines.push('');
      lines.push('## Wormholes');
    }
    for (const rn of regionNames) {
      lines.push(`### ${rn}`);
      const entries = (groups.get(rn) || []).sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        const life = e.eol ? '*@eol*' : '*Fresh*';
        const mass = e.critical ? '*@Crit*' : e.reduced ? '*@Reduced*' : '*Stable*';
        lines.push(`**${e.name}** => ***@${e.type}***, **Life:**  ${life}, **Mass:**  ${mass}`);
      }
      // blank line between regions for readability
      lines.push('');
    }
    // Route summaries (Discord markdown) AFTER wormholes list
    try {
      const namesByIdAny: any = namesById || {};
      const fromName = (fromId != null ? namesByIdAny[String(fromId)] : undefined) ?? (route.fromQuery || '—');
      const toName = (toId != null ? namesByIdAny[String(toId)] : undefined) ?? (route.toQuery || '—');
      // helpers to format flags inline next to WH names
      const flags = (wh: Wormhole | null | undefined) => {
        if (!wh) return '';
        const tags: string[] = [];
        if (wh.eol) tags.push('*@eol*');
        if (wh.critical) tags.push('*@Crit*');
        else if (wh.reduced) tags.push('*@Reduced*');
        return tags.length ? ` ${tags.join(' ')}` : '';
      };
      // Best route ignoring flags
      const bestAny = wormholeRoutes.length > 0 ? wormholeRoutes[0] : null;
      // Best route excluding EOL/Reduced/Critical
      const safeRoutes = wormholeRoutes.filter(r => !r.fromWh.eol && !r.toWh.eol && !r.fromWh.reduced && !r.toWh.reduced && !r.fromWh.critical && !r.toWh.critical);
      const bestSafe = safeRoutes.length > 0 ? safeRoutes[0] : null;

      lines.push('## Routes');
      if (bestAny) {
        const aName = (bestAny.fromWh.systemName || namesByIdAny[String(bestAny.fromWh.systemId)] || bestAny.fromWh.systemId) as string;
        const bName = (bestAny.toWh.systemName || namesByIdAny[String(bestAny.toWh.systemId)] || bestAny.toWh.systemId) as string;
        lines.push(`- **Best (any):** ${fromName} → **${aName}**${flags(bestAny.fromWh)} — ***@${bestAny.type}*** — **${bName}**${flags(bestAny.toWh)} → ${toName} • **Total:** ${bestAny.total} jumps`);
      } else {
        lines.push(`- **Best (any):** —`);
      }
      if (bestSafe) {
        const aName = (bestSafe.fromWh.systemName || namesByIdAny[String(bestSafe.fromWh.systemId)] || bestSafe.fromWh.systemId) as string;
        const bName = (bestSafe.toWh.systemName || namesByIdAny[String(bestSafe.toWh.systemId)] || bestSafe.toWh.systemId) as string;
        lines.push(`- **Best (safe):** ${fromName} → **${aName}** — ***@${bestSafe.type}*** — **${bName}** → ${toName} • **Total:** ${bestSafe.total} jumps`);
      } else {
        lines.push(`- **Best (safe):** —`);
      }
      lines.push(`- **Direct burn:** ${directJumps != null ? `${directJumps} jumps` : '—'}`);
    } catch {}

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
      const basePath = ((import.meta as any).env?.BASE_URL || '/');
      const base = `${window.location.origin}${basePath}scanner`;
      const url = `${base}?wh=${encodeURIComponent(b64)}&from=${encodeURIComponent(route.fromQuery || '')}&to=${encodeURIComponent(route.toQuery || '')}`;
      await navigator.clipboard.writeText(url);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus(null), 1500);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  // Precompute jump counts from start and destination to each wormhole system
  const jumpCounts = useMemo(() => {
    const out = new Map<string, { from: number | null; to: number | null }>();
    if (!graph || wormholes.length === 0) return out;
    const lyFrom = settings.titanBridgeFirstJump ? 6 : 0; // only apply titan on leg from start -> entry
    const lyTo = 0; // never apply titan on exit -> destination
    const MAX = 200; // generous cap for path search
    for (const wh of wormholes) {
      if (!wh.systemId || !Number.isFinite(wh.systemId)) { out.set(wh.id, { from: null, to: null }); continue; }
      let fromJ: number | null = null;
      let toJ: number | null = null;
      try {
        if (fromId != null) {
          const res = findPathTo({ startId: fromId, targetId: wh.systemId, maxJumps: MAX, graph, settings, lyRadius: lyFrom });
          fromJ = res.path ? (res.path.length - 1) : null;
        }
      } catch {}
      try {
        if (toId != null) {
          // Disallow titan on the exit->destination leg by overriding the flag and radius
          const toSettings = { ...settings, titanBridgeFirstJump: false };
          const res = findPathTo({ startId: toId, targetId: wh.systemId, maxJumps: MAX, graph, settings: toSettings, lyRadius: lyTo });
          toJ = res.path ? (res.path.length - 1) : null;
        }
      } catch {}
      out.set(wh.id, { from: fromJ, to: toJ });
    }
    return out;
  }, [graph, wormholes, fromId, toId, settings]);

  // Build all possible wormhole-assisted routes by pairing scanned wormholes of the same type
  const wormholeRoutes = useMemo(() => {
    const out: Array<{
      id: string;
      type: WormholeType;
      fromWh: Wormhole;
      toWh: Wormhole;
      fromJumps: number;
      toJumps: number;
      total: number;
    }> = [];
    if (!graph || fromId == null || toId == null) return out;
    // Filter to valid, typed wormholes with resolved system IDs
    const typed = wormholes.filter(w => w.systemId != null && w.type != null) as Array<Required<Pick<Wormhole, 'systemId' | 'type'>> & Wormhole>;
    if (typed.length < 2) return out;
    // For each pair with the same type, compute total using precomputed jumpCounts
    for (let i = 0; i < typed.length; i++) {
      const a = typed[i];
      const jcA = jumpCounts.get(a.id);
      const aFrom = jcA?.from;
      if (aFrom == null) continue;
      for (let j = 0; j < typed.length; j++) {
        if (i === j) continue;
        const b = typed[j];
        if (a.type !== b.type) continue;
        const jcB = jumpCounts.get(b.id);
        const bTo = jcB?.to;
        if (bTo == null) continue;
        const total = aFrom + bTo;
        out.push({ id: `${a.id}->${b.id}`, type: a.type!, fromWh: a, toWh: b, fromJumps: aFrom, toJumps: bTo, total });
      }
    }
    // Sort by total jumps asc, then by type then names
    const namesById: any = (graph as any)?.namesById || {};
    out.sort((r1, r2) =>
      r1.total - r2.total || String(r1.type).localeCompare(String(r2.type)) ||
      String(namesById[String(r1.fromWh.systemId!)] ?? '').localeCompare(String(namesById[String(r2.fromWh.systemId!)] ?? ''))
    );
    return out;
  }, [graph, fromId, toId, wormholes, jumpCounts]);

  const typePillClass = (t: WormholeType | null) => {
    const base = 'px-3 sm:px-4 py-1 sm:py-1.5 rounded-md border text-sm sm:text-base font-semibold shadow-sm ';
    if (t === 'Conflux') return base + 'bg-blue-600/10 border-blue-500/60 text-blue-700 dark:text-blue-300';
    if (t === 'Barbican') return base + 'bg-amber-500/10 border-amber-500/60 text-amber-700 dark:text-amber-300';
    if (t === 'Redoubt') return base + 'bg-gray-500/10 border-gray-500/60 text-gray-700 dark:text-gray-300';
    if (t === 'Sentinel') return base + 'bg-purple-500/10 border-purple-500/60 text-purple-700 dark:text-purple-300';
    if (t === 'Vidette') return base + 'bg-teal-500/10 border-teal-500/60 text-teal-700 dark:text-teal-300';
    return base + 'bg-gray-500/10 border-gray-400/60 text-slate-800 dark:text-slate-100';
  };

  // Route filters (apply to the routes list on the right)
  const [filterEol, setFilterEol] = useState(false);
  const [filterExcludeReduced, setFilterExcludeReduced] = useState(false);
  const [filterExcludeCritical, setFilterExcludeCritical] = useState(false);

  // Control visibility relative to direct route
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const directJumps = useMemo(() => (directGatePath && directGatePath.length > 0 ? directGatePath.length - 1 : null), [directGatePath]);
  // Apply filters to all wormhole-assisted routes
  const filteredWormholeRoutes = useMemo(() => {
    return wormholeRoutes.filter(r => {
      // EOL exclusion: if enabled, drop routes where either side is EOL
      if (filterEol) {
        const hasEol = !!(r.fromWh?.eol || r.toWh?.eol);
        if (hasEol) return false;
      }
      // Mass exclusion: drop routes where either side matches selected exclusions
      const isReduced = !!(r.fromWh?.reduced || r.toWh?.reduced);
      const isCritical = !!(r.fromWh?.critical || r.toWh?.critical);
      if (filterExcludeReduced && isReduced) return false;
      if (filterExcludeCritical && isCritical) return false;
      return true;
    });
  }, [wormholeRoutes, filterEol, filterExcludeReduced, filterExcludeCritical]);
  // Always render base routes above direct: routes that are not longer than direct
  const baseWormholeRoutes = useMemo(() => {
    if (directJumps == null) return filteredWormholeRoutes;
    return filteredWormholeRoutes.filter(r => r.total <= directJumps);
  }, [filteredWormholeRoutes, directJumps]);
  // Extra routes (longer than direct) appear below the dashed line and button when expanded
  const extraWormholeRoutes = useMemo(() => {
    if (directJumps == null) return [] as typeof wormholeRoutes;
    return filteredWormholeRoutes.filter(r => r.total > directJumps);
  }, [filteredWormholeRoutes, directJumps]);
  const hiddenRouteCount = extraWormholeRoutes.length;
  const hasHiddenRoutes = hiddenRouteCount > 0;

  // Context-aware empty state message for wormhole routes
  const sameTypeCounts = useMemo(() => {
    const counts: Partial<Record<WormholeType, number>> = {};
    for (const wh of wormholes) {
      if (!wh.type || wh.systemId == null) continue;
      counts[wh.type] = (counts[wh.type] || 0) + 1;
    }
    return counts;
  }, [wormholes]);
  const hasSameTypePair = useMemo(() => Object.values(sameTypeCounts).some((c) => (c || 0) >= 2), [sameTypeCounts]);
  const noRoutesMessage = useMemo(() => {
    if (wormholeRoutes.length > 0) return null;
    if (fromId == null || toId == null) return 'Select start and destination systems to see routes.';
    if (!hasSameTypePair) return 'Add at least two scanned wormholes of the same type.';
    return null;
  }, [wormholeRoutes.length, fromId, toId, hasSameTypePair]);

  // Determine warning icon color and tooltip for a wormhole side
  const getWhWarning = (wh: Wormhole | null | undefined): { color: string; title: string } | null => {
    if (!wh) return null;
    const labels: string[] = [];
    let color: string | null = null;
    // Mass state (critical overrides reduced for color)
    if (wh.critical) { labels.push('Critical'); color = '#ef4444'; }
    else if (wh.reduced) { labels.push('Reduced'); color = '#f59e0b'; }
    // Life state can combine with mass state
    if (wh.eol) { labels.unshift('End of Life'); if (!color) color = '#f59e0b'; }
    if (labels.length === 0) return null;
    return { color: color!, title: labels.join(' + ') };
  };

  return (
    <section className="grid gap-6 md:grid-cols-3 items-start">
      <div className="grid gap-6 md:pr-2 md:col-span-2">
      {/* Route selection panel */}
      <section className="grid gap-4 grid-cols-1 md:grid-cols-2 bg-white/50 dark:bg-black/20 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <label className="grid gap-2">
          Start system (name):
          <AutocompleteInput graph={graph} value={route.fromQuery} onChange={(v)=> setRoute(r => ({ ...r, fromQuery: v }))} placeholder="e.g. Jita" />
        </label>
        <label className="grid gap-2">
          Destination system (name):
          <AutocompleteInput graph={graph} value={route.toQuery} onChange={(v)=> setRoute(r => ({ ...r, toQuery: v }))} placeholder="e.g. Amarr" />
        </label>
        <fieldset className="md:col-span-2 border border-gray-200 dark:border-gray-700 rounded-md p-3">
          <legend className="px-1 text-sm text-gray-700 dark:text-gray-300">Settings</legend>
          <label className="inline-flex items-center gap-2 mr-4">
            <input type="checkbox" className="accent-blue-600" checked={settings.excludeZarzakh} onChange={(e)=> setSettings({ ...settings, excludeZarzakh: e.target.checked })} />
            <span>Exclude Zarzakh</span>
          </label>
          <label className="inline-flex items-center gap-2 mr-4">
            <input type="checkbox" className="accent-purple-600" checked={settings.titanBridgeFirstJump} onChange={(e)=> setSettings({ ...settings, titanBridgeFirstJump: e.target.checked })} />
            <span>Count Titan bridge from start as first jump</span>
          </label>
          <label className="inline-flex items-center gap-2 mr-3">
            <input type="checkbox" className="accent-blue-600" checked={!!settings.allowAnsiblex} onChange={(e)=> setSettings({ ...settings, allowAnsiblex: e.target.checked })} />
            <span>Allow Ansiblex jump bridges</span>
          </label>
          <button type="button" className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center justify-center gap-1 leading-none" onClick={() => {
            const ev = new CustomEvent('open-ansiblex-modal');
            window.dispatchEvent(ev);
          }}>
            <Icon name="gear" size={16} />
            <span className="inline-block align-middle">Configure…</span>
          </button>
          <button
            type="button"
            className="ml-auto px-2 py-1 text-sm rounded border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 leading-none float-right"
            onClick={() => setShowClearConfirm(true)}
            title="Clear all saved settings"
          >
            Clear settings
          </button>
        </fieldset>
      </section>

      <div className="flex items-center">
        <h1 className="text-2xl font-semibold">Scanner</h1>
      </div>

      {wormholes.length === 0 && (
        <p className="text-slate-600 dark:text-slate-300">No wormholes yet. Click "New Wormhole" to add one.</p>
      )}

      <ul className="grid gap-4">
        {wormholes.map((wh, idx) => (
          <li key={wh.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-4">
            <div className="grid md:grid-cols-8 gap-4 items-start">
              <div className="md:col-span-2">
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
                <div className="mt-3 flex items-center gap-3">
                  <button className="px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600" onClick={() => setWormholes(list => list.filter((_,i)=> i!==idx))}>Remove</button>
                  {(() => { const jc = jumpCounts.get(wh.id); return (
                    <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-normal sm:whitespace-nowrap">
                      {fromId != null && jc?.from != null ? `${jc.from} jumps from start` : '—'}
                      <span className="mx-2 text-gray-400">•</span>
                      {toId != null && jc?.to != null ? `${jc.to} jumps from destination` : '—'}
                    </span>
                  ); })()}
                </div>
              </div>
              <div className="min-w-0 md:col-span-2">
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
              <div className="min-w-0 md:col-span-1">
                <div className="font-semibold mb-2">End of Life?</div>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={wh.eol} onChange={(e)=> setWormholes(list => list.map((x,i)=> i===idx ? { ...x, eol: e.target.checked } : x))} />
                  <span>EoL</span>
                </label>
              </div>
              <div className="min-w-0 md:col-span-2">
                <div className="font-semibold mb-2">Mass</div>
                <div className="flex gap-3">
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
              <div className="min-w-0 md:col-span-1 md:justify-self-end">
                <div className="font-semibold mb-2">Bookmarks</div>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wh.bookmarkInside}
                      onChange={(e)=> setWormholes(list => list.map((x,i)=> i===idx ? { ...x, bookmarkInside: e.target.checked } : x))}
                    />
                    <span>In</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wh.bookmarkOutside}
                      onChange={(e)=> setWormholes(list => list.map((x,i)=> i===idx ? { ...x, bookmarkOutside: e.target.checked } : x))}
                    />
                    <span>Out</span>
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
        {/* Left spacer to keep the center button truly centered (matches two 36px buttons + 8px gap => 80px = w-20) */}
        <div className="w-20 shrink-0" aria-hidden="true" />
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
      </div>

      {/* Right: Routes panel (half width of left) */}
      <aside className="grid gap-4 md:pl-2 items-start content-start">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-black/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Routes</h2>
          </div>
          {/* Filters */}
          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-slate-800 dark:text-slate-200">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-amber-600"
                checked={filterEol}
                onChange={(e) => setFilterEol(e.target.checked)}
              />
              <span>Exclude EOL</span>
            </label>
            <div className="inline-flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-400">Exclude mass:</span>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={filterExcludeReduced}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      setFilterExcludeReduced(true);
                      setFilterExcludeCritical(true); // selecting Reduced also selects Critical
                    } else {
                      setFilterExcludeReduced(false);
                    }
                  }}
                />
                <span>Reduced</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={filterExcludeCritical}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (!checked) {
                      // deselecting Critical also deselects Reduced
                      setFilterExcludeCritical(false);
                      setFilterExcludeReduced(false);
                    } else {
                      setFilterExcludeCritical(true);
                    }
                  }}
                />
                <span>Critical</span>
              </label>
            </div>
          </div>
          {/* Wormhole-assisted routes derived from scanned wormholes */}
          {noRoutesMessage && (
            <div className="text-sm text-slate-600 dark:text-slate-400">{noRoutesMessage}</div>
          )}
          {!noRoutesMessage && filteredWormholeRoutes.length === 0 && (
            <div className="text-sm text-slate-600 dark:text-slate-400">No routes match the selected filters.</div>
          )}
          {baseWormholeRoutes.map((r) => (
            <div key={r.id} className="relative rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-4 bg-white dark:bg-gray-900 mb-4 last:mb-0">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 sm:gap-3.5 text-slate-800 dark:text-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-base sm:text-lg font-semibold tracking-wide text-left">{r.fromWh.systemName || (graph as any)?.namesById?.[String(r.fromWh.systemId)] || r.fromWh.systemId}</span>
                  <span className="relative h-px flex-1 bg-gray-300 dark:bg-gray-600">
                    {(() => { const w = getWhWarning(r.fromWh); return w ? (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Icon name="warn" size={14} color={w.color} title={w.title} />
                      </span>
                    ) : null; })()}
                  </span>
                </div>
                <span className={typePillClass(r.type)}>{r.type}</span>
                <div className="flex items-center gap-2">
                  <span className="relative h-px flex-1 bg-gray-300 dark:bg-gray-600">
                    {(() => { const w = getWhWarning(r.toWh); return w ? (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Icon name="warn" size={14} color={w.color} title={w.title} />
                      </span>
                    ) : null; })()}
                  </span>
                  <span className="text-base sm:text-lg font-semibold tracking-wide text-right">{r.toWh.systemName || (graph as any)?.namesById?.[String(r.toWh.systemId)] || r.toWh.systemId}</span>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center">
                <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 text-left">{r.fromJumps} jumps</div>
                <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-medium">Total: {r.total} jumps</div>
                <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 text-right">{r.toJumps} jumps</div>
              </div>
            </div>
          ))}
          {/* Direct gate route mock (placed below in same container) */}
          <div className="mt-4 relative rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-4 bg-white dark:bg-gray-900">
            <div className="flex items-center gap-2.5 sm:gap-3.5 text-slate-800 dark:text-slate-100">
              {(() => {
                const namesById: any = (graph as any)?.namesById || {};
                const left = ((fromId != null ? namesById[String(fromId)] : undefined) ?? (route.fromQuery || '—')) as string;
                const right = ((toId != null ? namesById[String(toId)] : undefined) ?? (route.toQuery || '—')) as string;
                return (
                  <>
                    <span className="text-base sm:text-lg font-semibold tracking-wide">{left}</span>
                    <span className="h-px flex-1 bg-gray-300 dark:bg-gray-600" />
                    <span className="text-base sm:text-lg font-semibold tracking-wide">{right}</span>
                  </>
                );
              })()}
            </div>
            <div className="mt-2 text-center text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-medium">
              {directGatePath && directGatePath.length > 0 ? `Total: ${directGatePath.length - 1} jumps` : 'Select start and destination'}
            </div>
          </div>
          {/* Separator */}
          <div className="my-3 border-t border-dashed border-gray-300 dark:border-gray-700" />
          {/* Toggle hidden routes visibility */}
          {hasHiddenRoutes && !showAllRoutes && (
            <div className="mt-3 text-center">
              <button
                type="button"
                className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setShowAllRoutes(true)}
              >
                Show all routes ({hiddenRouteCount} more)
              </button>
            </div>
          )}
          {hasHiddenRoutes && showAllRoutes && (
            <div className="mt-3 text-center">
              <button
                type="button"
                className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setShowAllRoutes(false)}
              >
                Hide extra routes
              </button>
            </div>
          )}
          {hasHiddenRoutes && showAllRoutes && (
            <div className="mt-3 grid gap-4">
              {extraWormholeRoutes.map((r) => (
                <div key={r.id} className="relative rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-4 bg-white dark:bg-gray-900">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 sm:gap-3.5 text-slate-800 dark:text-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="text-base sm:text-lg font-semibold tracking-wide text-left">{r.fromWh.systemName || (graph as any)?.namesById?.[String(r.fromWh.systemId)] || r.fromWh.systemId}</span>
                      <span className="relative h-px flex-1 bg-gray-300 dark:bg-gray-600">
                        {(() => { const w = getWhWarning(r.fromWh); return w ? (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <Icon name="warn" size={14} color={w.color} title={w.title} />
                          </span>
                        ) : null; })()}
                      </span>
                    </div>
                    <span className={typePillClass(r.type)}>{r.type}</span>
                    <div className="flex items-center gap-2">
                      <span className="relative h-px flex-1 bg-gray-300 dark:bg-gray-600">
                        {(() => { const w = getWhWarning(r.toWh); return w ? (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <Icon name="warn" size={14} color={w.color} title={w.title} />
                          </span>
                        ) : null; })()}
                      </span>
                      <span className="text-base sm:text-lg font-semibold tracking-wide text-right">{r.toWh.systemName || (graph as any)?.namesById?.[String(r.toWh.systemId)] || r.toWh.systemId}</span>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center">
                    <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 text-left">{r.fromJumps} jumps</div>
                    <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-medium">Total: {r.total} jumps</div>
                    <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 text-right">{r.toJumps} jumps</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}
