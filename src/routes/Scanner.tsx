import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { GraphData } from '../lib/data';
import { useCopyStatuses } from '../lib/copy';
import { resolveQueryToId, findPathTo } from '../lib/graph';
import { AnsiblexModal as SharedAnsiblexModal } from '../components/AnsiblexModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  ScannerRoutesSidebar,
  ScannerSetupPanel,
  ScannerWormholeList,
  type EolLevel,
  type MassLevel,
  type ScannerSettings,
  type ScannerWormhole as Wormhole,
  type ScannerWormholeRoute,
  type WormholeType,
} from '../components/ScannerPanels';

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
  const [settings, setSettings] = useState<ScannerSettings>(() => {
    const defaults = {
      excludeZarzakh: true,
      sameRegionOnly: false,
      titanBridgeFirstJump: false,
      allowAnsiblex: false,
      ansiblexes: [] as Array<{ from: number; to: number; enabled?: boolean }>,
      blacklistEnabled: false,
      blacklist: [] as Array<{ id: number; enabled?: boolean }>,
    };
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
            blacklistEnabled: typeof parsed.blacklistEnabled === 'boolean' ? parsed.blacklistEnabled : defaults.blacklistEnabled,
            blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : defaults.blacklist,
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
  const { copyStatuses, copyText } = useCopyStatuses();
  const [publicShare, setPublicShare] = useState(false);
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

  // flags bitmask (backward + forward compatible):
  // 1: legacy EOL boolean (read-only; treated as '<4h' if set),
  // 2: reduced (<50%), 4: critical (<10%), 8: bookmarkInside, 16: bookmarkOutside,
  // 32 + 64: EOL level code (00 none, 01 <1d, 10 <4h, 11 <1h)
  const eolToCode = (e: EolLevel | null): 0 | 1 | 2 | 3 => {
    if (e === 'lt1d') return 1;
    if (e === 'lt4h') return 2;
    if (e === 'lt1h') return 3;
    return 0;
  };
  const codeToEol = (code: number): EolLevel | null => {
    if (code === 1) return 'lt1d';
    if (code === 2) return 'lt4h';
    if (code === 3) return 'lt1h';
    return null;
  };
  const packFlags = (wh: Wormhole) => {
    const code = eolToCode(wh.eol);
    const eolBits = ((code & 1) ? 32 : 0) | ((code & 2) ? 64 : 0);
    return (
      0 | // legacy EOL bit intentionally not written
      (wh.mass === 'lt50' ? 2 : 0) |
      (wh.mass === 'lt10' ? 4 : 0) |
      (wh.bookmarkInside ? 8 : 0) |
      (wh.bookmarkOutside ? 16 : 0) |
      eolBits
    );
  };
  const unpackFlags = (n: number) => {
    const legacyEol = !!(n & 1);
    const codeBits = ((n & 32) ? 1 : 0) | ((n & 64) ? 2 : 0);
    const eol = codeToEol(codeBits) || (legacyEol ? 'lt4h' : null);
    // Map legacy mass flags to new MassLevel; prefer critical when both present
    const isReduced = !!(n & 2);
    const isCritical = !!(n & 4);
    let mass: MassLevel = 'gt50';
    if (isCritical) mass = 'lt10';
    else if (isReduced) mass = 'lt50';
    return {
      eol,
      mass,
      bookmarkInside: !!(n & 8),
      bookmarkOutside: !!(n & 16),
    } as const;
  };

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
      const { eol, mass, bookmarkInside, bookmarkOutside } = unpackFlags(Number(flags) || 0);
      out.push({ id: crypto.randomUUID(), systemId, systemName, type, eol, mass, bookmarkInside, bookmarkOutside });
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
      const publicParam = params.get('public');
      if (publicParam === '1' || publicParam === 'true') {
        setPublicShare(true);
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
      { id: crypto.randomUUID(), systemId: null, systemName: '', type: null, eol: 'lt1d', mass: 'gt50', bookmarkInside: false, bookmarkOutside: false },
    ]);
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

  const buildShareUrl = (includePublic: boolean) => {
    const compact = buildCompact(wormholes);
    const b64 = btoa(JSON.stringify(compact));
    const basePath = ((import.meta as any).env?.BASE_URL || '/');
    const base = `${window.location.origin}${basePath}scanner`;
    const params = new URLSearchParams();
    params.set('wh', b64);
    params.set('from', route.fromQuery || '');
    params.set('to', route.toQuery || '');
    if (includePublic) params.set('public', '1');
    return `${base}?${params.toString()}`;
  };

  const handleCopyDiscord = async () => {
    const now = Math.floor(Date.now() / 1000);
    const regionsById: any = (graph as any)?.regionsById || {};
    const systems: any = (graph as any)?.systems || {};
    const namesById: any = (graph as any)?.namesById || {};

    // group valid entries by region name
    const groups = new Map<string, Array<{
      name: string;
      type: WormholeType;
      eol: EolLevel | null;
      mass: MassLevel;
      bookmarkInside: boolean;
      bookmarkOutside: boolean;
    }>>();
    for (const wh of wormholes) {
      if (!wh.systemId || !wh.type) continue;
      const sys = systems[String(wh.systemId)];
      if (!sys) continue;
      const regionName = String(regionsById[String(sys.regionId)] ?? sys.regionId ?? '');
      const systemName = String(namesById[String(wh.systemId)] ?? wh.systemName ?? wh.systemId);
      const arr = groups.get(regionName) || [];
      arr.push({
        name: systemName,
        type: wh.type,
        eol: wh.eol,
        mass: wh.mass,
        bookmarkInside: !!wh.bookmarkInside,
        bookmarkOutside: !!wh.bookmarkOutside,
      });
      groups.set(regionName, arr);
    }

    // build lines
    const lines: string[] = [];
    // Build a share link for the current wormholes and linkify the heading text
    try {
      const url = buildShareUrl(publicShare);
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
        const life = e.eol === 'lt1h' ? '@<1h' : e.eol === 'lt4h' ? '@<4h' : e.eol === 'lt1d' ? '@<1d' : '@Fresh';
        const mass = e.mass === 'lt10' ? '@<10%' : e.mass === 'lt50' ? '@<50%' : '@>50%';
        const bookmarkFlags: string[] = [];
        if (e.bookmarkInside) bookmarkFlags.push('In');
        if (e.bookmarkOutside) bookmarkFlags.push('Out');
        const bookmarkText = bookmarkFlags.length ? `, **Bookmarks:** ${bookmarkFlags.join(' + ')}` : '';
        lines.push(`**${e.name}** => ***@${e.type}***, **Life:**  ${life}, **Mass:**  ${mass}${bookmarkText}`);
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
        if (wh.eol === 'lt1h') tags.push('@<1h');
        else if (wh.eol === 'lt4h') tags.push('@<4h');
        else if (wh.eol === 'lt1d') tags.push('@<1d');
        if (wh.mass === 'lt10') tags.push('@<10%');
        else if (wh.mass === 'lt50') tags.push('@<50%');
        if (wh.bookmarkInside && wh.bookmarkOutside) tags.push('*BM:In/Out*');
        else if (wh.bookmarkInside) tags.push('*BM:In*');
        else if (wh.bookmarkOutside) tags.push('*BM:Out*');
        return tags.length ? ` ${tags.join(' ')}` : '';
      };
      // Best route ignoring flags
      const bestAny = wormholeRoutes.length > 0 ? wormholeRoutes[0] : null;
      // Best route excluding any life flags and mass issues
      const safeRoutes = wormholeRoutes.filter(r => !r.fromWh.eol && !r.toWh.eol && r.fromWh.mass === 'gt50' && r.toWh.mass === 'gt50');
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
    await copyText(text, 'discord', { success: 1500, error: 2000 });
  };

  const handleCopyLink = async () => {
    try {
      const url = buildShareUrl(publicShare);
      await copyText(url, 'link', { success: 1500, error: 2000 });
    } catch {
      // URL generation failed before clipboard copy.
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
  const wormholeRoutes = useMemo<ScannerWormholeRoute[]>(() => {
    const out: ScannerWormholeRoute[] = [];
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

  // Route filters (apply to the routes list on the right)
  // Life requirement: require both sides to have at least the selected life bucket
  const [filterEolThreshold, setFilterEolThreshold] = useState<EolLevel>('lt1h');
  // Mass requirement: require both sides to have at least the selected mass bucket
  const [filterMassThreshold, setFilterMassThreshold] = useState<MassLevel>('lt10');

  // Control visibility relative to direct route
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const directJumps = useMemo(() => (directGatePath && directGatePath.length > 0 ? directGatePath.length - 1 : null), [directGatePath]);
  // Apply filters to all wormhole-assisted routes
  const filteredWormholeRoutes = useMemo(() => {
    const order: EolLevel[] = ['lt1d', 'lt4h', 'lt1h'];
    const meetsMin = (val: EolLevel | null | undefined, min: EolLevel) => {
      if (!val) return false; // only consider wormholes with an explicit EOL marker
      return order.indexOf(val) <= order.indexOf(min);
    };
    const mOrder: MassLevel[] = ['gt50', 'lt50', 'lt10'];
    const massMeetsMin = (val: MassLevel | null | undefined, min: MassLevel) => {
      if (!val) return false;
      return mOrder.indexOf(val) <= mOrder.indexOf(min);
    };
    return wormholeRoutes.filter(r => {
      // Life requirement: keep route only if BOTH sides meet or exceed the selected bucket
      const aOk = meetsMin(r.fromWh?.eol, filterEolThreshold);
      const bOk = meetsMin(r.toWh?.eol, filterEolThreshold);
      if (!(aOk && bOk)) return false;
      // Mass requirement: keep only if BOTH sides meet or exceed selected mass bucket
      const aMassOk = massMeetsMin(r.fromWh?.mass, filterMassThreshold);
      const bMassOk = massMeetsMin(r.toWh?.mass, filterMassThreshold);
      if (!(aMassOk && bMassOk)) return false;
      return true;
    });
  }, [wormholeRoutes, filterEolThreshold, filterMassThreshold]);
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

  return (
    <section className="grid gap-6 md:grid-cols-3 items-start">
      <div className="grid gap-6 md:pr-2 md:col-span-2">
        <ScannerSetupPanel
          graph={graph}
          route={route}
          settings={settings}
          onRouteChange={setRoute}
          onSettingsChange={setSettings}
          onConfigureAnsiblex={() => {
            const event = new CustomEvent('open-ansiblex-modal');
            window.dispatchEvent(event);
          }}
          onClearSettings={() => setShowClearConfirm(true)}
        />

        <ScannerWormholeList
          graph={graph}
          wormholes={wormholes}
          observatoryItems={observatoryItems}
          jumpCounts={jumpCounts}
          fromId={fromId}
          toId={toId}
          publicShare={publicShare}
          copyStatuses={copyStatuses}
          onWormholesChange={setWormholes}
          onAddNew={addNew}
          onPublicShareChange={setPublicShare}
          onCopyDiscord={handleCopyDiscord}
          onCopyLink={handleCopyLink}
        />

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

      <ScannerRoutesSidebar
        graph={graph}
        route={route}
        fromId={fromId}
        toId={toId}
        directGatePath={directGatePath}
        noRoutesMessage={noRoutesMessage}
        filteredWormholeRoutes={filteredWormholeRoutes}
        baseWormholeRoutes={baseWormholeRoutes}
        extraWormholeRoutes={extraWormholeRoutes}
        hiddenRouteCount={hiddenRouteCount}
        hasHiddenRoutes={hasHiddenRoutes}
        showAllRoutes={showAllRoutes}
        filterEolThreshold={filterEolThreshold}
        filterMassThreshold={filterMassThreshold}
        onFilterEolThresholdChange={setFilterEolThreshold}
        onFilterMassThresholdChange={setFilterMassThreshold}
        onShowAllRoutesChange={setShowAllRoutes}
      />
    </section>
  );
}
