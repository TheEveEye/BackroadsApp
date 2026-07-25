import type { GraphData, SystemNode } from './data';

export const SOVEREIGNTY_PLAN_STORAGE_KEY = 'br.sovereigntyPlanner.plan.v1';
export const ADVANCED_LOGISTICS_NETWORK_TYPE_ID = 81621;
export const ANSIBLEX_MAX_RANGE_LY = 5;
export const METERS_PER_LIGHT_YEAR = 9.4607e15;

export type SovereigntyUpgradeCategory =
  | 'Strategic'
  | 'Ratting'
  | 'Mining'
  | 'Exploration'
  | 'Colony Resources'
  | 'System Effects';

export type SovereigntyUpgradeFuel = {
  typeId: number;
  startupCost: number;
  hourlyUpkeep: number;
};

export type SovereigntyUpgradeDefinition = {
  typeId: number;
  name: string;
  description: string;
  category: SovereigntyUpgradeCategory;
  family?: string;
  tier?: number;
  mutuallyExclusiveGroup?: string;
  powerAllocation: number;
  powerProduction: number;
  workforceAllocation: number;
  workforceProduction: number;
  fuel?: SovereigntyUpgradeFuel;
};

export type PlannedSystemUpgrade = {
  typeId: number;
};

export type PlannedAnsiblexLink = {
  id: string;
  from: number;
  to: number;
};

export type SovereigntyPlan = {
  upgradesBySystem: Record<string, PlannedSystemUpgrade[]>;
  ansiblexLinks: PlannedAnsiblexLink[];
};

export type SystemResourceSummary = {
  basePower: number;
  producedPower: number;
  totalPower: number;
  allocatedPower: number;
  remainingPower: number;
  baseWorkforce: number;
  producedWorkforce: number;
  totalWorkforce: number;
  allocatedWorkforce: number;
  remainingWorkforce: number;
  workforceImportRequired: number;
  workforceSurplus: number;
  magmaticGasStartup: number;
  magmaticGasHourly: number;
  superionicIceStartup: number;
  superionicIceHourly: number;
  upgradeCount: number;
};

export type SovereigntyPlanSummary = {
  systems: Record<string, SystemResourceSummary>;
  powerDeficitSystems: number;
  workforceDeficitSystems: number;
  workforceImportRequired: number;
  workforceSurplus: number;
  magmaticGasStartup: number;
  magmaticGasHourly: number;
  superionicIceStartup: number;
  superionicIceHourly: number;
  upgradeCount: number;
  ansiblexCount: number;
};

export function emptySovereigntyPlan(): SovereigntyPlan {
  return { upgradesBySystem: {}, ansiblexLinks: [] };
}

export function getSovereigntyUpgradeIconUrl(typeId: number) {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}eve/sovereignty-upgrades/${typeId}.png`;
}

export async function loadSovereigntyUpgradeDefinitions(signal?: AbortSignal) {
  const base = import.meta.env.BASE_URL || '/';
  const response = await fetch(`${base}data/sovereignty_upgrades.json`, { signal });
  if (!response.ok) throw new Error('Failed to load sovereignty upgrade definitions.');
  const definitions = await response.json();
  if (!Array.isArray(definitions)) {
    throw new Error('Sovereignty upgrade definitions have an invalid format.');
  }
  return definitions as SovereigntyUpgradeDefinition[];
}

export function normalizeSovereigntyPlan(value: unknown): SovereigntyPlan {
  if (!value || typeof value !== 'object') return emptySovereigntyPlan();
  const candidate = value as Partial<SovereigntyPlan>;
  const upgradesBySystem: Record<string, PlannedSystemUpgrade[]> = {};
  if (candidate.upgradesBySystem && typeof candidate.upgradesBySystem === 'object') {
    for (const [systemId, upgrades] of Object.entries(candidate.upgradesBySystem)) {
      if (!Number.isInteger(Number(systemId)) || !Array.isArray(upgrades)) continue;
      const seen = new Set<number>();
      const cleaned = upgrades
        .map((upgrade) => Number((upgrade as PlannedSystemUpgrade)?.typeId))
        .filter((typeId) => {
          if (!Number.isInteger(typeId) || typeId <= 0 || seen.has(typeId)) return false;
          seen.add(typeId);
          return true;
        })
        .map((typeId) => ({ typeId }));
      if (cleaned.length > 0) upgradesBySystem[systemId] = cleaned;
    }
  }

  const seenLinks = new Set<string>();
  const ansiblexLinks = (Array.isArray(candidate.ansiblexLinks) ? candidate.ansiblexLinks : [])
    .map((link) => ({
      id: typeof link?.id === 'string' && link.id
        ? link.id
        : canonicalAnsiblexId(Number(link?.from), Number(link?.to)),
      from: Number(link?.from),
      to: Number(link?.to),
    }))
    .filter((link) => {
      const key = canonicalAnsiblexId(link.from, link.to);
      if (
        !Number.isInteger(link.from)
        || !Number.isInteger(link.to)
        || link.from === link.to
        || seenLinks.has(key)
      ) return false;
      seenLinks.add(key);
      link.id = key;
      return true;
    });

  return { upgradesBySystem, ansiblexLinks };
}

export function indexUpgradeDefinitions(definitions: readonly SovereigntyUpgradeDefinition[]) {
  return new Map(definitions.map((definition) => [definition.typeId, definition]));
}

export function calculateSystemResources(
  system: SystemNode,
  upgrades: readonly PlannedSystemUpgrade[],
  definitionsById: ReadonlyMap<number, SovereigntyUpgradeDefinition>,
): SystemResourceSummary {
  let producedPower = 0;
  let allocatedPower = 0;
  let producedWorkforce = 0;
  let allocatedWorkforce = 0;
  let magmaticGasStartup = 0;
  let magmaticGasHourly = 0;
  let superionicIceStartup = 0;
  let superionicIceHourly = 0;

  for (const planned of upgrades) {
    const definition = definitionsById.get(planned.typeId);
    if (!definition) continue;
    producedPower += definition.powerProduction;
    allocatedPower += definition.powerAllocation;
    producedWorkforce += definition.workforceProduction;
    allocatedWorkforce += definition.workforceAllocation;
    if (definition.fuel?.typeId === 81143) {
      magmaticGasStartup += definition.fuel.startupCost;
      magmaticGasHourly += definition.fuel.hourlyUpkeep;
    } else if (definition.fuel?.typeId === 81144) {
      superionicIceStartup += definition.fuel.startupCost;
      superionicIceHourly += definition.fuel.hourlyUpkeep;
    }
  }

  const basePower = system.power ?? 0;
  const totalPower = basePower + producedPower;
  const remainingPower = totalPower - allocatedPower;
  const baseWorkforce = system.workforce ?? 0;
  const totalWorkforce = baseWorkforce + producedWorkforce;
  const remainingWorkforce = totalWorkforce - allocatedWorkforce;
  return {
    basePower,
    producedPower,
    totalPower,
    allocatedPower,
    remainingPower,
    baseWorkforce,
    producedWorkforce,
    totalWorkforce,
    allocatedWorkforce,
    remainingWorkforce,
    workforceImportRequired: Math.max(0, -remainingWorkforce),
    workforceSurplus: Math.max(0, remainingWorkforce),
    magmaticGasStartup,
    magmaticGasHourly,
    superionicIceStartup,
    superionicIceHourly,
    upgradeCount: upgrades.length,
  };
}

export function calculateSovereigntyPlan(
  graph: GraphData | null,
  plan: SovereigntyPlan,
  definitions: readonly SovereigntyUpgradeDefinition[],
  selectedSystemIds?: ReadonlySet<number>,
): SovereigntyPlanSummary {
  const definitionsById = indexUpgradeDefinitions(definitions);
  const systems: Record<string, SystemResourceSummary> = {};
  let powerDeficitSystems = 0;
  let workforceDeficitSystems = 0;
  let workforceImportRequired = 0;
  let workforceSurplus = 0;
  let magmaticGasStartup = 0;
  let magmaticGasHourly = 0;
  let superionicIceStartup = 0;
  let superionicIceHourly = 0;
  let upgradeCount = 0;

  if (graph) {
    const systemIds = selectedSystemIds
      ? Array.from(selectedSystemIds, String)
      : Object.keys(plan.upgradesBySystem);
    for (const systemId of systemIds) {
      const system = graph.systems[systemId];
      if (!system) continue;
      const upgrades = plan.upgradesBySystem[systemId] ?? [];
      const summary = calculateSystemResources(system, upgrades, definitionsById);
      systems[systemId] = summary;
      if (summary.remainingPower < 0) powerDeficitSystems += 1;
      if (summary.remainingWorkforce < 0) workforceDeficitSystems += 1;
      workforceImportRequired += summary.workforceImportRequired;
      workforceSurplus += summary.workforceSurplus;
      magmaticGasStartup += summary.magmaticGasStartup;
      magmaticGasHourly += summary.magmaticGasHourly;
      superionicIceStartup += summary.superionicIceStartup;
      superionicIceHourly += summary.superionicIceHourly;
      upgradeCount += summary.upgradeCount;
    }
  }

  return {
    systems,
    powerDeficitSystems,
    workforceDeficitSystems,
    workforceImportRequired,
    workforceSurplus,
    magmaticGasStartup,
    magmaticGasHourly,
    superionicIceStartup,
    superionicIceHourly,
    upgradeCount,
    ansiblexCount: plan.ansiblexLinks.length,
  };
}

export function getPlacementPowerBlockReason(
  system: SystemNode,
  currentUpgrades: readonly PlannedSystemUpgrade[],
  definition: SovereigntyUpgradeDefinition,
  definitionsById: ReadonlyMap<number, SovereigntyUpgradeDefinition>,
) {
  const replaced = definition.mutuallyExclusiveGroup
    ? currentUpgrades.filter((planned) => (
      definitionsById.get(planned.typeId)?.mutuallyExclusiveGroup
      !== definition.mutuallyExclusiveGroup
    ))
    : currentUpgrades;
  const prospective = calculateSystemResources(
    system,
    [...replaced, { typeId: definition.typeId }],
    definitionsById,
  );
  return definition.powerAllocation > prospective.totalPower
    ? `${definition.name} requires ${definition.powerAllocation.toLocaleString()} power; this system can provide ${prospective.totalPower.toLocaleString()}.`
    : null;
}

export function canonicalAnsiblexId(from: number, to: number) {
  return from < to ? `${from}-${to}` : `${to}-${from}`;
}

export function getAnsiblexDistanceLy(graph: GraphData, from: number, to: number) {
  const a = graph.systems[String(from)]?.position;
  const b = graph.systems[String(to)]?.position;
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / METERS_PER_LIGHT_YEAR;
}

export function removeSystemsFromPlan(
  plan: SovereigntyPlan,
  removedSystemIds: ReadonlySet<number>,
): SovereigntyPlan {
  const removedLinks = plan.ansiblexLinks.filter(
    (link) => removedSystemIds.has(link.from) || removedSystemIds.has(link.to),
  );
  const affectedAnsiblexEndpoints = new Set(
    removedLinks.flatMap((link) => [link.from, link.to]),
  );
  const upgradesBySystem = Object.fromEntries(
    Object.entries(plan.upgradesBySystem)
      .filter(([systemId]) => !removedSystemIds.has(Number(systemId)))
      .map(([systemId, upgrades]) => [
        systemId,
        affectedAnsiblexEndpoints.has(Number(systemId))
          ? upgrades.filter(
            (upgrade) => upgrade.typeId !== ADVANCED_LOGISTICS_NETWORK_TYPE_ID,
          )
          : upgrades,
      ])
      .filter(([, upgrades]) => upgrades.length > 0),
  );
  const ansiblexLinks = plan.ansiblexLinks.filter(
    (link) => !removedSystemIds.has(link.from) && !removedSystemIds.has(link.to),
  );
  return { upgradesBySystem, ansiblexLinks };
}
