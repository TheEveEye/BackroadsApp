import type { AnsiblexLink, AnsiblexPlannerState, SovereigntySnapshot } from './ansiblex';

export const SOVEREIGNTY_CACHE_KEY = 'br.bridgePlanner.sovereignty.v1';
const ESI = 'https://esi.evetech.net';
const HEADERS = { Accept: 'application/json', 'X-Compatibility-Date': '2026-05-19' };
let retryAt = 0;

export class SovereigntyRequestError extends Error {
  retryAt: number;
  constructor(message: string, nextAttempt: number) {
    super(message);
    this.retryAt = nextAttempt;
  }
}

export function resolvePlanningAllianceId(
  overrideAllianceId: number | null, links: readonly AnsiblexLink[],
  snapshot: SovereigntySnapshot | null, now = Date.now(), characterAllianceId: number | null = null,
): number | null {
  if (overrideAllianceId != null) return overrideAllianceId;
  return (snapshot && snapshot.expiresAt > now ? inferNetworkAllianceId(links, snapshot) : null) ?? characterAllianceId;
}

function inferNetworkAllianceId(links: readonly AnsiblexLink[], snapshot: SovereigntySnapshot): number | null {
  // Each physical departure gate counts once, even if it appears in several links.
  const endpoints = new Set<number>();
  for (const link of links) {
    if (link.enabled === false) continue;
    endpoints.add(link.from);
    endpoints.add(link.to);
  }
  const counts = new Map<number, number>();
  for (const endpoint of endpoints) {
    const owner = snapshot.owners[String(endpoint)];
    if (owner != null) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  for (const [allianceId, count] of counts) {
    if (count > endpoints.size / 2) return allianceId;
  }
  return null;
}

/** Cached sovereignty may keep the map visible, but must not establish routing access. */
export function resolveAnsiblexMapReference(
  planner: Pick<AnsiblexPlannerState, 'allianceId' | 'capitalOverrides'>, links: readonly AnsiblexLink[],
  snapshot: SovereigntySnapshot | null, characterAllianceId: number | null, now = Date.now(),
) {
  const networkAllianceId = snapshot ? inferNetworkAllianceId(links, snapshot) : null;
  const allianceId = planner.allianceId ?? networkAllianceId ?? characterAllianceId;
  const capitalOverride = allianceId == null ? null : planner.capitalOverrides[String(allianceId)] ?? null;
  const capitalId = capitalOverride ?? (allianceId == null ? null : snapshot?.capitals[String(allianceId)] ?? null);
  const source = planner.allianceId != null || capitalOverride != null ? 'Advanced override'
    : networkAllianceId != null ? 'Network majority' : 'Character alliance';
  return { allianceId, capitalId, source, cached: capitalOverride == null && snapshot != null && snapshot.expiresAt <= now };
}

export function parseSovereigntySystems(value: unknown, fetchedAt: number, expiresAt: number): SovereigntySnapshot {
  if (!value || typeof value !== 'object' || !('solar_systems' in value) || !Array.isArray(value.solar_systems)) {
    throw new Error('ESI returned an invalid sovereignty response.');
  }
  const snapshot: SovereigntySnapshot = { fetchedAt, expiresAt, owners: {}, capitals: {} };
  const ambiguousCapitals = new Set<number>();
  for (const row of value.solar_systems) {
    if (!Number.isSafeInteger(row?.solar_system_id) || row.solar_system_id <= 0) continue;
    const alliance = row.claim?.alliance;
    const id = alliance?.alliance_id;
    if (Number.isSafeInteger(id) && id > 0) {
      snapshot.owners[row.solar_system_id] = id;
      if (alliance.is_capital_system === true) {
        if (snapshot.capitals[id] != null) ambiguousCapitals.add(id);
        snapshot.capitals[id] = row.solar_system_id;
      }
    } else if (row.claim?.unclaimed === true || row.claim?.faction?.faction_id) {
      snapshot.owners[row.solar_system_id] = null;
    }
  }
  for (const id of ambiguousCapitals) delete snapshot.capitals[id];
  return snapshot;
}

export function readSovereigntyCache(): SovereigntySnapshot | null {
  try {
    const raw = localStorage.getItem(SOVEREIGNTY_CACHE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (!value || !Number.isFinite(value.fetchedAt) || !Number.isFinite(value.expiresAt)
      || !value.owners || typeof value.owners !== 'object' || !value.capitals || typeof value.capitals !== 'object') return null;
    return value;
  } catch {
    return null;
  }
}

export async function loadAnsiblexSovereignty(cached: SovereigntySnapshot | null, signal?: AbortSignal): Promise<SovereigntySnapshot> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached;
  if (now < retryAt) throw new SovereigntyRequestError('ESI requested a pause before retrying.', retryAt);
  const response = await fetch(`${ESI}/sovereignty/systems`, { headers: HEADERS, signal });
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
    retryAt = seconds != null ? now + seconds * 1000 : Math.max(now + 60_000, retry ? Date.parse(retry) || 0 : 0);
    throw new SovereigntyRequestError(`Sovereignty unavailable (ESI ${response.status}).`, retryAt);
  }
  const ttl = Number(response.headers.get('Cache-Control')?.match(/(?:^|[,\s])max-age=(\d+)/)?.[1] ?? 300);
  const age = Number(response.headers.get('Age') ?? 0);
  const snapshot = parseSovereigntySystems(await response.json(), now - Math.max(0, age) * 1000,
    now + Math.max(0, Math.min(300, ttl) - age) * 1000);
  snapshot.allianceNames = { ...cached?.allianceNames };
  const ids = [...new Set(Object.values(snapshot.owners).filter((id): id is number => id != null))]
    .filter((id) => !snapshot.allianceNames?.[String(id)]);
  if (ids.length) {
    try {
      const namesResponse = await fetch(`${ESI}/universe/names`, {
        method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(ids), signal,
      });
      if (namesResponse.ok) {
        const rows = await namesResponse.json();
        if (Array.isArray(rows)) for (const row of rows) {
          if (row.category === 'alliance' && Number.isSafeInteger(row.id) && typeof row.name === 'string') snapshot.allianceNames[String(row.id)] = row.name;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      // Ownership and capitals remain useful when name resolution is unavailable.
    }
  }
  try {
    localStorage.setItem(SOVEREIGNTY_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // The in-memory snapshot remains usable when browser storage is unavailable.
  }
  return snapshot;
}
