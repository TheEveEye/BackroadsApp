import type { GraphData, SystemNode } from './data';

export const SOVEREIGNTY_PLAN_STORAGE_KEY = 'br.sovereigntyPlanner.plan.v1';
export const SOVEREIGNTY_PLAN_FILE_FORMAT = 'backroads-sovereignty-plan';
export const SOVEREIGNTY_PLAN_FILE_VERSION = 1;
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

export type SovereigntyUpgradeResourceLine = {
  label: string;
  amount: number;
  production?: boolean;
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

export type SovereigntyPlanFile = {
  format: typeof SOVEREIGNTY_PLAN_FILE_FORMAT;
  version: typeof SOVEREIGNTY_PLAN_FILE_VERSION;
  exportedAt: string;
  territorySystemIds: number[];
  capitalSystemId: number | null;
  plan: SovereigntyPlan;
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

export function getSovereigntyUpgradeResourceLines(
  definition: SovereigntyUpgradeDefinition,
): SovereigntyUpgradeResourceLine[] {
  const rows: SovereigntyUpgradeResourceLine[] = [];
  if (definition.powerAllocation !== 0) {
    rows.push({ label: 'Power allocation', amount: definition.powerAllocation });
  }
  if (definition.powerProduction !== 0) {
    rows.push({
      label: 'Power production',
      amount: definition.powerProduction,
      production: true,
    });
  }
  if (definition.workforceAllocation !== 0) {
    rows.push({
      label: 'Workforce allocation',
      amount: definition.workforceAllocation,
    });
  }
  if (definition.workforceProduction !== 0) {
    rows.push({
      label: 'Workforce production',
      amount: definition.workforceProduction,
      production: true,
    });
  }
  if (definition.fuel) {
    const fuelName = definition.fuel.typeId === 81143
      ? 'Magmatic Gas'
      : definition.fuel.typeId === 81144
        ? 'Superionic Ice'
        : `Fuel ${definition.fuel.typeId}`;
    if (definition.fuel.startupCost !== 0) {
      rows.push({
        label: `${fuelName} startup`,
        amount: definition.fuel.startupCost,
      });
    }
    if (definition.fuel.hourlyUpkeep !== 0) {
      rows.push({
        label: `${fuelName} / hour`,
        amount: definition.fuel.hourlyUpkeep,
      });
    }
  }
  return rows;
}

export function createSovereigntyPlanFile(
  plan: SovereigntyPlan,
  territorySystemIds: ReadonlySet<number>,
  capitalSystemId: number | null,
): SovereigntyPlanFile {
  return {
    format: SOVEREIGNTY_PLAN_FILE_FORMAT,
    version: SOVEREIGNTY_PLAN_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    territorySystemIds: Array.from(territorySystemIds).sort((a, b) => a - b),
    capitalSystemId,
    plan,
  };
}

export function parseSovereigntyPlanFile(value: unknown): SovereigntyPlanFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('This file does not contain a sovereignty plan.');
  }
  const candidate = value as Partial<SovereigntyPlanFile>;
  if (candidate.format !== SOVEREIGNTY_PLAN_FILE_FORMAT) {
    throw new Error('This is not a Backroads sovereignty plan file.');
  }
  if (candidate.version !== SOVEREIGNTY_PLAN_FILE_VERSION) {
    throw new Error(`Sovereignty plan file version ${String(candidate.version)} is not supported.`);
  }
  if (!Array.isArray(candidate.territorySystemIds)) {
    throw new Error('The sovereignty plan has an invalid territory list.');
  }
  if (!candidate.plan || typeof candidate.plan !== 'object' || Array.isArray(candidate.plan)) {
    throw new Error('The sovereignty plan data is missing.');
  }
  const rawPlan = candidate.plan as Partial<SovereigntyPlan>;
  if (
    !rawPlan.upgradesBySystem
    || typeof rawPlan.upgradesBySystem !== 'object'
    || Array.isArray(rawPlan.upgradesBySystem)
    || !Array.isArray(rawPlan.ansiblexLinks)
  ) {
    throw new Error('The sovereignty plan data is invalid.');
  }

  const territorySystemIds = candidate.territorySystemIds;
  if (territorySystemIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('The sovereignty plan contains an invalid territory system.');
  }
  for (const [systemId, upgrades] of Object.entries(rawPlan.upgradesBySystem)) {
    if (
      !Number.isSafeInteger(Number(systemId))
      || Number(systemId) <= 0
      || String(Number(systemId)) !== systemId
      || !Array.isArray(upgrades)
    ) {
      throw new Error('The sovereignty plan contains invalid system upgrades.');
    }
    const seenTypeIds = new Set<number>();
    for (const upgrade of upgrades) {
      const typeId = (upgrade as PlannedSystemUpgrade)?.typeId;
      if (
        !upgrade
        || typeof upgrade !== 'object'
        || Array.isArray(upgrade)
        || !Number.isSafeInteger(typeId)
        || typeId <= 0
        || seenTypeIds.has(typeId)
      ) {
        throw new Error('The sovereignty plan contains an invalid or duplicate upgrade.');
      }
      seenTypeIds.add(typeId);
    }
  }
  const seenLinkIds = new Set<string>();
  for (const link of rawPlan.ansiblexLinks) {
    const from = (link as PlannedAnsiblexLink)?.from;
    const to = (link as PlannedAnsiblexLink)?.to;
    const id = canonicalAnsiblexId(from, to);
    if (
      !link
      || typeof link !== 'object'
      || Array.isArray(link)
      || !Number.isSafeInteger(from)
      || !Number.isSafeInteger(to)
      || from <= 0
      || to <= 0
      || from === to
      || seenLinkIds.has(id)
    ) {
      throw new Error('The sovereignty plan contains an invalid or duplicate Ansiblex link.');
    }
    seenLinkIds.add(id);
  }

  const capitalSystemId = candidate.capitalSystemId == null
    ? null
    : candidate.capitalSystemId;
  if (
    capitalSystemId != null
    && (!Number.isSafeInteger(capitalSystemId) || capitalSystemId <= 0)
  ) {
    throw new Error('The sovereignty plan contains an invalid capital system.');
  }

  return {
    format: SOVEREIGNTY_PLAN_FILE_FORMAT,
    version: SOVEREIGNTY_PLAN_FILE_VERSION,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : '',
    territorySystemIds: Array.from(new Set(territorySystemIds)).sort((a, b) => a - b),
    capitalSystemId,
    plan: normalizeSovereigntyPlan(candidate.plan),
  };
}

// Resource deficits remain valid planning states, including after removing a generator.
export function validateSovereigntyPlanFile(
  file: SovereigntyPlanFile,
  graph: GraphData,
  definitionsById: ReadonlyMap<number, SovereigntyUpgradeDefinition>,
): void {
  const territorySystemIds = new Set(file.territorySystemIds);
  const getSystemName = (systemId: number) => (
    graph.namesById?.[String(systemId)] ?? String(systemId)
  );

  for (const systemId of territorySystemIds) {
    const system = graph.systems[String(systemId)];
    if (!system?.isSovereigntyEligible) {
      throw new Error(`${getSystemName(systemId)} is not a valid sovereignty system.`);
    }
  }
  if (
    file.capitalSystemId != null
    && !territorySystemIds.has(file.capitalSystemId)
  ) {
    throw new Error('The capital system is outside the imported territory.');
  }

  const endpointSystemIds = new Set<number>();
  for (const link of file.plan.ansiblexLinks) {
    if (
      !territorySystemIds.has(link.from)
      || !territorySystemIds.has(link.to)
    ) {
      throw new Error('An imported Ansiblex endpoint is outside the territory.');
    }
    if (endpointSystemIds.has(link.from) || endpointSystemIds.has(link.to)) {
      throw new Error('A system is used by more than one imported Ansiblex link.');
    }
    if (getAnsiblexDistanceLy(graph, link.from, link.to) > ANSIBLEX_MAX_RANGE_LY) {
      throw new Error(
        `${getSystemName(link.from)} and ${getSystemName(link.to)} exceed the Ansiblex range limit.`,
      );
    }
    endpointSystemIds.add(link.from);
    endpointSystemIds.add(link.to);
  }

  for (const [systemIdValue, upgrades] of Object.entries(file.plan.upgradesBySystem)) {
    const systemId = Number(systemIdValue);
    if (!territorySystemIds.has(systemId)) {
      throw new Error(`${getSystemName(systemId)} has upgrades but is outside the territory.`);
    }
    const exclusivityGroups = new Set<string>();
    for (const upgrade of upgrades) {
      const definition = definitionsById.get(upgrade.typeId);
      if (!definition) {
        throw new Error(`Upgrade type ${upgrade.typeId} is not available in this SDE.`);
      }
      if (
        definition.typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID
        && !endpointSystemIds.has(systemId)
      ) {
        throw new Error(`${getSystemName(systemId)} has an Ansiblex upgrade without a link.`);
      }
      if (
        definition.mutuallyExclusiveGroup
        && exclusivityGroups.has(definition.mutuallyExclusiveGroup)
      ) {
        throw new Error(`${getSystemName(systemId)} contains conflicting upgrades.`);
      }
      if (definition.mutuallyExclusiveGroup) {
        exclusivityGroups.add(definition.mutuallyExclusiveGroup);
      }
    }
  }

  for (const systemId of endpointSystemIds) {
    const hasAnsiblexUpgrade = (
      file.plan.upgradesBySystem[String(systemId)] ?? []
    ).some((upgrade) => upgrade.typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID);
    if (!hasAnsiblexUpgrade) {
      throw new Error(`${getSystemName(systemId)} is missing its Ansiblex endpoint upgrade.`);
    }
  }
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
