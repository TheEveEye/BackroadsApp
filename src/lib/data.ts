export type SystemNode = {
  systemId: number;
  constellationId: number;
  regionId: number;
  position: { x: number; y: number; z: number };
  security?: number;
  adjacentSystems: number[];
  hasObservatory: boolean;
  isRegional: boolean;
};

export type GraphData = {
  regionsById?: Record<string, string>;
  systems: Record<string, SystemNode>;
  namesById?: Record<string, string>;
  idsByName?: Record<string, number>;
};

export async function loadData(): Promise<GraphData> {
  const base = import.meta.env.BASE_URL || '/';
  const systemsResp = await fetch(`${base}data/systems_index.json`);
  if (!systemsResp.ok) throw new Error('Failed to load systems_index.json');
  const systems = (await systemsResp.json()) as Record<string, SystemNode>;

  let namesById: Record<string, string> | undefined;
  let regionsById: Record<string, string> | undefined;
  let idsByName: Record<string, number> | undefined;
  try {
  const namesResp = await fetch(`${base}data/system_names.json`);
    if (namesResp.ok) {
      const names = (await namesResp.json()) as {
        byId: Record<string, string>;
        byName?: Record<string, number>;
      };
      namesById = names.byId;
      // Build a normalized idsByName map once: uppercase and strip spaces/dashes
      const norm = (s: string) => s.toUpperCase().replace(/[-\s]/g, '');
      const map: Record<string, number> = {};
      for (const [idStr, name] of Object.entries(names.byId || {})) {
        const id = Number(idStr);
        if (!Number.isFinite(id)) continue;
        const key = norm(String(name || ''));
        if (key) map[key] = id;
      }
      // If a byName map exists, fold it in (normalize keys), but prefer byId-derived entries
      if (names.byName) {
        for (const [k, v] of Object.entries(names.byName)) {
          const key = norm(k);
          const id = Number(v);
          if (key && Number.isFinite(id) && map[key] == null) map[key] = id;
        }
      }
      idsByName = map;
    }
  } catch (_) {
    // optional
  }

  
  try {
  const regionsResp = await fetch(`${base}data/region_names.json`);
    if (regionsResp.ok) {
      const regions = (await regionsResp.json()) as { byId: Record<string, string> };
      regionsById = regions.byId;
    }
  } catch (_) {
    // optional
  }
  return { systems, namesById, idsByName, regionsById };
}
