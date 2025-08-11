export type SystemNode = {
  systemId: number;
  constellationId: number;
  regionId: number;
  position: { x: number; y: number; z: number };
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
  const systemsResp = await fetch('/data/systems_index.json');
  if (!systemsResp.ok) throw new Error('Failed to load systems_index.json');
  const systems = (await systemsResp.json()) as Record<string, SystemNode>;

  let namesById: Record<string, string> | undefined;
  let regionsById: Record<string, string> | undefined;
  let idsByName: Record<string, number> | undefined;
  try {
    const namesResp = await fetch('/data/system_names.json');
    if (namesResp.ok) {
      const names = (await namesResp.json()) as {
        byId: Record<string, string>;
        byName: Record<string, number>;
      };
      namesById = names.byId;
      idsByName = names.byName;
    }
  } catch (_) {
    // optional
  }

  
  try {
    const regionsResp = await fetch('/data/region_names.json');
    if (regionsResp.ok) {
      const regions = (await regionsResp.json()) as { byId: Record<string, string> };
      regionsById = regions.byId;
    }
  } catch (_) {
    // optional
  }
  return { systems, namesById, idsByName, regionsById };
}
