export type SovereigntyHolderKind = 'alliance' | 'corporation';

export type SovereigntyHolder = {
  id: number;
  kind: SovereigntyHolderKind;
  name: string;
  systemIds: number[];
};

type SovereigntyMapEntry = {
  alliance_id?: number;
  faction_id?: number;
  system_id?: number;
};

type UniverseNameEntry = {
  category?: string;
  id?: number;
  name?: string;
};

const ESI_BASE_URL = 'https://esi.evetech.net/latest';
const ESI_COMPATIBILITY_DATE = '2025-09-30';
const UNIVERSE_NAMES_BATCH_SIZE = 1000;
const ALLIANCE_REQUEST_CONCURRENCY = 8;

const ESI_HEADERS = {
  Accept: 'application/json',
  'X-Compatibility-Date': ESI_COMPATIBILITY_DATE,
};

async function readJson(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`EVE ESI request failed (${response.status}).`);
  }
  return data;
}

async function resolveOwnerNames(ownerIds: number[], signal?: AbortSignal) {
  const names = new Map<number, string>();
  for (let start = 0; start < ownerIds.length; start += UNIVERSE_NAMES_BATCH_SIZE) {
    const batch = ownerIds.slice(start, start + UNIVERSE_NAMES_BATCH_SIZE);
    const response = await fetch(`${ESI_BASE_URL}/universe/names/?datasource=tranquility`, {
      method: 'POST',
      headers: {
        ...ESI_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
      signal,
    });
    const rows = await readJson(response);
    if (!Array.isArray(rows)) continue;
    for (const row of rows as UniverseNameEntry[]) {
      const id = Number(row.id);
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (Number.isInteger(id) && name) names.set(id, name);
    }
  }
  return names;
}

async function loadAllianceCorporations(
  alliances: Array<{ id: number; systemIds: Set<number> }>,
  signal?: AbortSignal,
) {
  const corporations = new Map<number, Set<number>>();
  let nextAllianceIndex = 0;
  const worker = async () => {
    while (nextAllianceIndex < alliances.length) {
      const alliance = alliances[nextAllianceIndex];
      nextAllianceIndex += 1;
      try {
        const response = await fetch(
          `${ESI_BASE_URL}/alliances/${alliance.id}/corporations/?datasource=tranquility`,
          { headers: ESI_HEADERS, signal },
        );
        const corporationIds = await readJson(response);
        if (!Array.isArray(corporationIds)) continue;
        for (const corporationIdValue of corporationIds) {
          const corporationId = Number(corporationIdValue);
          if (!Number.isInteger(corporationId) || corporationId <= 0) continue;
          const systemIds = corporations.get(corporationId) ?? new Set<number>();
          for (const systemId of alliance.systemIds) systemIds.add(systemId);
          corporations.set(corporationId, systemIds);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        // Keep alliance search available when one membership request fails.
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(ALLIANCE_REQUEST_CONCURRENCY, alliances.length) },
      () => worker(),
    ),
  );
  return corporations;
}

export async function loadSovereigntyHolders(
  eligibleSystemIds: ReadonlySet<number>,
  signal?: AbortSignal,
): Promise<SovereigntyHolder[]> {
  const response = await fetch(`${ESI_BASE_URL}/sovereignty/map/?datasource=tranquility`, {
    headers: ESI_HEADERS,
    signal,
  });
  const rows = await readJson(response);
  if (!Array.isArray(rows)) throw new Error('EVE ESI returned an invalid sovereignty map.');

  const holders = new Map<string, { id: number; kind: SovereigntyHolderKind; systemIds: Set<number> }>();
  const addOwner = (kind: SovereigntyHolderKind, ownerId: unknown, systemId: number) => {
    const id = Number(ownerId);
    if (!Number.isInteger(id) || id <= 0) return;
    const key = `${kind}:${id}`;
    const holder = holders.get(key) ?? { id, kind, systemIds: new Set<number>() };
    holder.systemIds.add(systemId);
    holders.set(key, holder);
  };

  for (const row of rows as SovereigntyMapEntry[]) {
    const systemId = Number(row.system_id);
    if (!Number.isInteger(systemId) || !eligibleSystemIds.has(systemId)) continue;
    addOwner('alliance', row.alliance_id, systemId);
  }

  const alliances = Array.from(holders.values(), (holder) => ({
    id: holder.id,
    systemIds: holder.systemIds,
  }));
  const corporationSystems = await loadAllianceCorporations(alliances, signal);
  for (const [corporationId, systemIds] of corporationSystems) {
    holders.set(`corporation:${corporationId}`, {
      id: corporationId,
      kind: 'corporation',
      systemIds,
    });
  }

  const ownerIds = Array.from(new Set(Array.from(holders.values(), (holder) => holder.id)));
  const names = await resolveOwnerNames(ownerIds, signal);
  return Array.from(holders.values())
    .map((holder) => ({
      id: holder.id,
      kind: holder.kind,
      name: names.get(holder.id) ?? `${holder.kind === 'alliance' ? 'Alliance' : 'Corporation'} ${holder.id}`,
      systemIds: Array.from(holder.systemIds).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}
