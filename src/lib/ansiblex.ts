import type { RouteStep } from './bridgeRoutes';

export const ANSIBLEX_PLANNER_STORAGE_KEY = 'br.bridgePlanner.ansiblex.v1';
export const METERS_PER_LY = 9.4607e15;
export type AnsiblexZone = 1 | 2 | 3 | 4 | 5;
export type AnsiblexLink = { from: number; to: number; enabled?: boolean; bidirectional?: boolean };
export type ShipClass = { id: string; name: string; groupId: number; eligible: boolean; baseCostTj: number | null };
export type AnsiblexRules = {
  rulesDate: string;
  capacityTj: number;
  zones: Array<{ maxLy: number | null; multiplier: number }>;
  classes: ShipClass[];
};
export type FleetRow = { classId: string; count: number };
export type EndpointState = {
  ownerAllianceId?: number;
  chargeTj?: number;
  observedAt?: number;
};
export type AnsiblexPlannerState = {
  maxZone: AnsiblexZone;
  showZoneOverlay: boolean;
  allianceId: number | null; // null follows network sovereignty, falling back to the character alliance
  fleet: FleetRow[];
  fleetConfigured: boolean;
  endpoints: Record<string, EndpointState>;
  capitalOverrides: Record<string, number>;
};
export type SovereigntySnapshot = {
  fetchedAt: number;
  expiresAt: number;
  owners: Record<string, number | null>;
  capitals: Record<string, number>;
  allianceNames?: Record<string, string>;
};
export type PositionedGraph = { systems: Record<string, { position: { x: number; y: number; z: number } }> };
export type ResolvedAnsiblexEdge = {
  from: number;
  to: number;
  bidirectional: false;
  blocked: boolean;
  reasons: string[];
  ownerAllianceId: number | null;
  capitalId: number | null;
  capitalDistanceLy: number | null;
  zone: number | null;
  multiplier: number | null;
};

export function emptyAnsiblexPlanner(): AnsiblexPlannerState {
  return { maxZone: 5, showZoneOverlay: true, allianceId: null, fleet: [], fleetConfigured: false, endpoints: {}, capitalOverrides: {} };
}

export function normalizeMaxAnsiblexZone(value: unknown): AnsiblexZone {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(5, Math.trunc(value))) as AnsiblexZone : 5;
}

export type AnsiblexZonePreferences = Pick<AnsiblexPlannerState, 'maxZone' | 'showZoneOverlay'>;

export function normalizeAnsiblexZonePreferences(value: unknown): AnsiblexZonePreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { maxZone: normalizeMaxAnsiblexZone(input.maxZone), showZoneOverlay: input.showZoneOverlay !== false };
}

export function isAnsiblexZoneAllowed(zone: number | null, maxZone: AnsiblexZone): boolean {
  return zone == null ? maxZone === 5 : zone >= 1 && zone <= maxZone;
}

export function filterAnsiblexEdges(edges: readonly ResolvedAnsiblexEdge[], maxZone: AnsiblexZone) {
  return edges.filter((edge) => !edge.blocked && isAnsiblexZoneAllowed(edge.zone, maxZone));
}

function positiveId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function normalizeAnsiblexPlanner(value: unknown, capacityTj = 1250): AnsiblexPlannerState {
  const result = emptyAnsiblexPlanner();
  if (!value || typeof value !== 'object') return result;
  const input = value as Record<string, unknown>;
  result.maxZone = normalizeMaxAnsiblexZone(input.maxZone);
  result.showZoneOverlay = input.showZoneOverlay !== false;
  result.allianceId = positiveId(input.allianceId) ?? null;
  result.fleetConfigured = input.fleetConfigured === true;
  if (Array.isArray(input.fleet)) {
    result.fleet = input.fleet.flatMap((row) => {
      if (!row || typeof row.classId !== 'string' || !Number.isSafeInteger(row.count) || row.count <= 0) return [];
      return [{ classId: row.classId, count: row.count }];
    });
  }
  if (input.endpoints && typeof input.endpoints === 'object') {
    for (const [id, raw] of Object.entries(input.endpoints)) {
      if (!positiveId(Number(id)) || !raw || typeof raw !== 'object') continue;
      const row = raw as EndpointState;
      result.endpoints[id] = {
        ownerAllianceId: positiveId(row.ownerAllianceId),
        chargeTj: typeof row.chargeTj === 'number' && Number.isFinite(row.chargeTj)
          ? Math.max(0, Math.min(capacityTj, row.chargeTj)) : undefined,
        observedAt: positiveId(row.observedAt),
      };
    }
  }
  if (input.capitalOverrides && typeof input.capitalOverrides === 'object') {
    for (const [id, systemId] of Object.entries(input.capitalOverrides)) {
      if (positiveId(Number(id)) && positiveId(systemId)) result.capitalOverrides[id] = Number(systemId);
    }
  }
  return result;
}

export function normalizeAnsiblexLinks(value: unknown): AnsiblexLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || !positiveId(Number(row.from)) || !positiveId(Number(row.to)) || Number(row.from) === Number(row.to)) return [];
    return [{ from: Number(row.from), to: Number(row.to), enabled: row.enabled !== false, bidirectional: row.bidirectional !== false }];
  });
}

export function exportAnsiblexPlan(links: AnsiblexLink[], planner: AnsiblexPlannerState) {
  return JSON.stringify({ format: 'backroads-ansiblex', version: 1, links, planner }, null, 2);
}

export function importAnsiblexPlan(text: string): { links: AnsiblexLink[]; planner?: AnsiblexPlannerState } {
  const value = JSON.parse(text);
  if (Array.isArray(value)) return { links: normalizeAnsiblexLinks(value) };
  if (value?.format !== 'backroads-ansiblex' || value.version !== 1 || !Array.isArray(value.links)) {
    throw new Error('Unsupported Ansiblex plan. Use a version 1 planner export or a legacy link array.');
  }
  return { links: normalizeAnsiblexLinks(value.links), planner: normalizeAnsiblexPlanner(value.planner) };
}

const SELF_JUMP_CLASSES: Record<string, string> = {
  'Black Ops': '898', 'Carrier Jump': '547', Dreadnought: '485', 'Force Auxiliary': '1538',
  'Jump Freighter': '902', 'Lancer Dreadnought': '4594', Rorqual: '883', 'Supercarrier Jump': '659', 'Titan Jump': '30',
};
export function fleetForPreset(preset: string): FleetRow[] {
  return SELF_JUMP_CLASSES[preset] ? [{ classId: SELF_JUMP_CLASSES[preset], count: 1 }] : [];
}

export function getAnsiblexZone(distanceLy: number, rules: AnsiblexRules) {
  if (!Number.isFinite(distanceLy) || distanceLy < 0) return null;
  const index = rules.zones.findIndex((zone) => zone.maxLy == null || distanceLy <= zone.maxLy);
  return index < 0 ? null : { zone: index + 1, multiplier: rules.zones[index].multiplier };
}

export function fleetBaseCost(fleet: FleetRow[], rules: AnsiblexRules): number | null {
  if (!fleet.length) return null;
  let total = 0;
  for (const row of fleet) {
    const ship = rules.classes.find((candidate) => candidate.id === row.classId);
    if (!ship?.eligible || ship.baseCostTj == null || !Number.isSafeInteger(row.count) || row.count <= 0) return null;
    total += row.count * ship.baseCostTj;
  }
  return Number.isFinite(total) ? total : null;
}

export function resolveAnsiblexEdges(
  links: readonly AnsiblexLink[], planner: AnsiblexPlannerState, allianceId: number | null,
  snapshot: SovereigntySnapshot | null, graph: PositionedGraph, rules: AnsiblexRules, now = Date.now(),
): ResolvedAnsiblexEdge[] {
  const edges: ResolvedAnsiblexEdge[] = [];
  const fresh = snapshot != null && now < snapshot.expiresAt;
  const prohibited = planner.fleet.some((row) => row.count > 0 && rules.classes.find((ship) => ship.id === row.classId)?.eligible === false);
  for (const link of links) {
    if (link.enabled === false) continue;
    for (const [from, to] of link.bidirectional === false ? [[link.from, link.to]] : [[link.from, link.to], [link.to, link.from]]) {
      const endpoint = planner.endpoints[String(from)] ?? {};
      const reasons: string[] = [];
      const sovOwner = fresh ? snapshot.owners[String(from)] : undefined;
      const ownerAllianceId = endpoint.ownerAllianceId ?? sovOwner ?? null;
      if (prohibited) reasons.push('The fleet contains ships that cannot use Ansiblexes.');
      if (sovOwner === null) reasons.push('Departure system has no alliance sovereignty.');
      if (allianceId && sovOwner != null && sovOwner !== allianceId) reasons.push('Departure sovereignty belongs to another alliance.');
      if (allianceId && ownerAllianceId != null && ownerAllianceId !== allianceId) reasons.push('Departure gate belongs to another alliance.');
      const capitalId = ownerAllianceId == null ? null : planner.capitalOverrides[String(ownerAllianceId)]
        ?? (fresh ? snapshot.capitals[String(ownerAllianceId)] : undefined) ?? null;
      const capital = capitalId == null ? null : graph.systems[String(capitalId)];
      const destination = graph.systems[String(to)];
      const distance = capital && destination ? Math.hypot(
        capital.position.x - destination.position.x, capital.position.y - destination.position.y, capital.position.z - destination.position.z,
      ) / METERS_PER_LY : null;
      const d = distance != null && Number.isFinite(distance) ? distance : null;
      const zone = d == null ? null : getAnsiblexZone(d, rules);
      edges.push({ from, to, bidirectional: false, blocked: reasons.length > 0,
        reasons, ownerAllianceId, capitalId, capitalDistanceLy: d, zone: zone?.zone ?? null, multiplier: zone?.multiplier ?? null });
    }
  }
  return edges;
}

export type AnsiblexRouteZones = { count: number; zones: number[]; unknownZone: boolean };

export function getAnsiblexRouteZones(steps: readonly RouteStep[], edges: readonly ResolvedAnsiblexEdge[]): AnsiblexRouteZones {
  const byDirection = new Map(edges.map((edge) => [`${edge.from}->${edge.to}`, edge]));
  const traversals = steps.filter((step) => step.kind === 'ansiblex')
    .map((step) => byDirection.get(`${step.fromId}->${step.toId}`));
  return {
    count: traversals.length,
    zones: [...new Set(traversals.flatMap((edge) => edge?.zone == null ? [] : [edge.zone]))].sort((a, b) => a - b),
    unknownZone: traversals.some((edge) => edge?.zone == null),
  };
}

export function ansiblexZoneSummary(summary: AnsiblexRouteZones): string {
  if (!summary.count) return '';
  return [
    `${summary.count} Ansiblex`,
    summary.zones.length ? `Zone${summary.zones.length === 1 ? '' : 's'} ${summary.zones.join(', ')}` : '',
    summary.unknownZone ? 'zone unknown' : '',
  ].filter(Boolean).join(' · ');
}

export type AnsiblexStepEstimate = {
  stepIndex: number;
  fromId: number;
  toId: number;
  zone: number | null;
  capitalDistanceLy: number | null;
  demandTj: number | null;
  chargeTj: number;
  assumedFull: boolean;
  observedAt?: number;
  remainingTj: number | null;
  shortfallTj: number | null;
};
export type AnsiblexRouteEstimate = { steps: AnsiblexStepEstimate[]; bottlenecks: number; totalTj: number | null };

export function estimateAnsiblexRoute(
  steps: readonly RouteStep[], edges: readonly ResolvedAnsiblexEdge[], planner: AnsiblexPlannerState, rules: AnsiblexRules,
): AnsiblexRouteEstimate {
  const edgeMap = new Map(edges.map((edge) => [`${edge.from}->${edge.to}`, edge]));
  const base = fleetBaseCost(planner.fleet, rules);
  const demandByEndpoint = new Map<number, number | null>();
  const estimates: AnsiblexStepEstimate[] = [];
  for (const [stepIndex, step] of steps.entries()) {
    if (step.kind !== 'ansiblex') continue;
    const edge = edgeMap.get(`${step.fromId}->${step.toId}`);
    const state = planner.endpoints[String(step.fromId)] ?? {};
    const chargeTj = state.chargeTj ?? rules.capacityTj;
    const demandTj = base != null && edge?.multiplier != null ? base * edge.multiplier : null;
    const previous = demandByEndpoint.get(step.fromId) ?? (demandByEndpoint.has(step.fromId) ? null : 0);
    const cumulative = previous != null && demandTj != null ? previous + demandTj : null;
    demandByEndpoint.set(step.fromId, cumulative);
    estimates.push({ stepIndex, fromId: step.fromId, toId: step.toId, zone: edge?.zone ?? null,
      capitalDistanceLy: edge?.capitalDistanceLy ?? null, demandTj, chargeTj, assumedFull: state.chargeTj == null,
      observedAt: state.observedAt, remainingTj: cumulative == null ? null : Math.max(0, chargeTj - cumulative),
      shortfallTj: cumulative == null ? null : Math.max(0, cumulative - chargeTj) });
  }
  return { steps: estimates, bottlenecks: estimates.filter((step) => (step.shortfallTj ?? 0) > 0).length,
    totalTj: estimates.some((step) => step.demandTj == null) ? null : estimates.reduce((sum, step) => sum + (step.demandTj ?? 0), 0) };
}

export function ansiblexSummary(estimate: AnsiblexRouteEstimate): string {
  if (!estimate.steps.length) return '';
  return [
    `${estimate.steps.length} Ansiblex`, estimate.totalTj == null ? 'capacitor cost unknown' : `${estimate.totalTj.toLocaleString()} TJ fleet cost`,
    estimate.steps.some((step) => step.assumedFull) ? 'unmeasured gates assumed full' : 'manual charge snapshots',
    estimate.bottlenecks ? `${estimate.bottlenecks} capacitor bottleneck(s)` : '',
  ].filter(Boolean).join(' · ');
}

export async function loadAnsiblexRules(signal?: AbortSignal): Promise<AnsiblexRules> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/ansiblex_rules.json`, { signal });
  if (!response.ok) throw new Error('Unable to load Ansiblex rules.');
  return response.json();
}
