import { describe, expect, it } from 'vitest';
import catalog from '../public/data/ansiblex_rules.json';
import {
  ansiblexSummary, emptyAnsiblexPlanner, estimateAnsiblexRoute, exportAnsiblexPlan, fleetBaseCost,
  fleetForPreset, getAnsiblexZone, importAnsiblexPlan, METERS_PER_LY, normalizeAnsiblexLinks,
  normalizeAnsiblexPlanner, normalizeAnsiblexZonePreferences, resolveAnsiblexEdges, type AnsiblexPlannerState, type SovereigntySnapshot,
} from '../src/lib/ansiblex';
import { getItineraryIds, mergeWaypointRoute, type RouteOption, type RouteStep } from '../src/lib/bridgeRoutes';

const now = 1_000_000;
const snapshot: SovereigntySnapshot = { fetchedAt: now - 1000, expiresAt: now + 300_000, owners: { 1: 10, 2: 10, 3: 20 }, capitals: { 10: 9, 20: 8 } };
const graph = { systems: Object.fromEntries([[1, 6], [2, 11], [3, 16], [8, 30], [9, 0]].map(([id, x]) => [id, { position: { x: x * METERS_PER_LY, y: 0, z: 0 } }])) };
const link = { from: 1, to: 2 };
function planner(classId = '963', count = 1): AnsiblexPlannerState {
  return { ...emptyAnsiblexPlanner(), allianceId: 10, fleetConfigured: true, fleet: [{ classId, count }], endpoints: { 1: { ownerAllianceId: 10 }, 2: { ownerAllianceId: 10 } } };
}
const steps: RouteStep[] = [{ kind: 'ansiblex', fromId: 1, toId: 2 }];
function resolve(state = planner(), sov: SovereigntySnapshot | null = snapshot, alliance: number | null = 10) {
  return resolveAnsiblexEdges([link], state, alliance, sov, graph, catalog, now);
}

describe('Ansiblex costs', () => {
  it.each([[0, 1, 0], [5, 1, 0], [5.000001, 2, 2], [10, 2, 2], [10.000001, 3, 6], [15, 3, 6], [15.000001, 4, 9], [20, 4, 9], [20.000001, 5, 15]])('classifies %s LY without rounding', (distance, zone, multiplier) => {
    expect(getAnsiblexZone(distance, catalog)).toEqual({ zone, multiplier });
  });
  it('does not turn missing coordinates into free travel', () => {
    expect(getAnsiblexZone(NaN, catalog)).toBeNull();
    expect(getAnsiblexZone(-1, catalog)).toBeNull();
  });
  it('matches the published Tengu and Black Ops examples', () => {
    expect(estimateAnsiblexRoute(steps, resolve(), planner(), catalog).totalTj).toBe(78);
    const edges = resolveAnsiblexEdges([{ from: 1, to: 3 }], planner('898'), 10, snapshot, graph, catalog, now);
    expect(estimateAnsiblexRoute([{ kind: 'ansiblex', fromId: 1, toId: 3 }], edges, planner('898'), catalog).totalTj).toBe(162);
  });
  it('uses full 3D distance from the owner capital, not link length', () => {
    const shifted = { systems: { ...graph.systems, 2: { position: { x: 0, y: 0, z: 11 * METERS_PER_LY } } } };
    expect(resolveAnsiblexEdges([link], planner(), 10, snapshot, shifted, catalog, now)[0].zone).toBe(3);
    expect(resolve()[0].multiplier).toBe(6);
    expect(resolve()[1].multiplier).toBe(2);
  });
  it('derives the Rorqual costs instead of copying inconsistent totals', () => {
    expect(fleetBaseCost(planner('883').fleet, catalog)).toBe(19);
    expect(19 * getAnsiblexZone(6, catalog)!.multiplier).toBe(38);
    expect(19 * getAnsiblexZone(11, catalog)!.multiplier).toBe(114);
  });
  it('sums mixed classes and reports fleet shortfalls without changing edges', () => {
    const state = planner('963', 10);
    state.fleet.push({ classId: '898', count: 5 });
    const result = estimateAnsiblexRoute(steps, resolve(state), state, catalog);
    expect(result.totalTj).toBe(1320);
    expect(result.steps[0].shortfallTj).toBe(70);
    expect(resolve(state)[0].blocked).toBe(false);
    expect(ansiblexSummary(result)).toContain('bottleneck');
    expect(ansiblexSummary(result)).toContain('assumed full');
  });
  it('handles exact capacity, empty gates, and manual snapshot timestamps', () => {
    const state = planner();
    state.endpoints[1] = { ...state.endpoints[1], chargeTj: 78, observedAt: now };
    expect(estimateAnsiblexRoute(steps, resolve(state), state, catalog).steps[0]).toMatchObject({ remainingTj: 0, shortfallTj: 0, assumedFull: false, observedAt: now });
    state.endpoints[1].chargeTj = 0;
    expect(estimateAnsiblexRoute(steps, resolve(state), state, catalog).steps[0].shortfallTj).toBe(78);
  });
  it('keeps Zone 1 demand zero even with a zero-charge snapshot', () => {
    const state = planner(); state.endpoints[1].chargeTj = 0;
    const edges = resolveAnsiblexEdges([{ from: 1, to: 9 }], state, 10, snapshot, graph, catalog, now);
    expect(estimateAnsiblexRoute([{ kind: 'ansiblex', fromId: 1, toId: 9 }], edges, state, catalog).steps[0]).toMatchObject({ demandTj: 0, shortfallTj: 0 });
  });
  it('accumulates repeated departure demand and keeps opposite gates separate', () => {
    const state = planner('963', 10);
    const route: RouteStep[] = [steps[0], { kind: 'ansiblex', fromId: 2, toId: 1 }, steps[0]];
    const result = estimateAnsiblexRoute(route, resolve(state), state, catalog);
    expect(result.steps.map((step) => step.remainingTj)).toEqual([470, 990, 0]);
    expect(result.steps[2].shortfallTj).toBe(310);
  });
  it('propagates unknown demand through later visits', () => {
    const state = planner();
    const edges = resolve(); edges[0].multiplier = null;
    const result = estimateAnsiblexRoute([...steps, ...steps], edges, state, catalog);
    expect(result.totalTj).toBeNull();
    expect(result.steps.every((step) => step.remainingTj == null)).toBe(true);
    expect(fleetBaseCost([{ classId: 'unknown', count: 1 }], catalog)).toBeNull();
    expect(fleetBaseCost([], catalog)).toBeNull();
  });
});

describe('Ansiblex eligibility', () => {
  it('allows known compatible ships and ownership', () => expect(resolve()[0].blocked).toBe(false));
  it('uses departure ownership only and resolves the reverse independently', () => {
    const state = planner();
    state.endpoints[2].ownerAllianceId = 20;
    expect(resolve(state).map((edge) => edge.blocked)).toEqual([false, true]);
  });
  it('blocks known ownership and sovereignty incompatibilities', () => {
    const state = planner(); state.endpoints[1].ownerAllianceId = 20;
    expect(resolve(state)[0].reasons.join()).toContain('gate belongs');
    expect(resolve(planner(), { ...snapshot, owners: { 1: 20 } })[0].reasons.join()).toContain('sovereignty belongs');
    expect(resolve(planner(), { ...snapshot, owners: { 1: null } })[0].blocked).toBe(true);
  });
  it('uses inferred ownership without an uncertainty status', () => {
    const state = planner(); state.endpoints = {};
    expect(resolve(state)[0]).toMatchObject({ blocked: false, ownerAllianceId: 10, capitalId: 9 });
    expect(resolve(state)[0]).not.toHaveProperty('access');
  });
  it('does not use expired sovereignty to determine ownership or zones', () => {
    const state = planner(); state.endpoints = {};
    const edge = resolve(state, { ...snapshot, owners: { 1: 20 }, expiresAt: now - 1 })[0];
    expect(edge).toMatchObject({ blocked: false, ownerAllianceId: null, capitalId: null, multiplier: null });
    expect(resolve(state, null, null)[0].blocked).toBe(false);
  });
  it('uses explicit owner and capital overrides during a data outage', () => {
    const state = planner(); state.capitalOverrides[10] = 9;
    expect(resolve(state, null)[0]).toMatchObject({ blocked: false, capitalId: 9, multiplier: 6 });
  });
  it.each(['547', '485', '1538', '4594', '659', '30', '5120'])('excludes capital group %s', (id) => expect(resolve(planner(id))[0].blocked).toBe(true));
  it.each(['883', '513', '902'])('permits industrial exception %s', (id) => expect(resolve(planner(id))[0].blocked).toBe(false));
  it('does not classify bridged passengers as their bridge provider', () => {
    expect(fleetForPreset('Titan Bridge')).toEqual([]);
    expect(fleetForPreset('Carrier Conduit')).toEqual([]);
    expect(fleetForPreset('Carrier Jump')).toEqual([{ classId: '547', count: 1 }]);
  });
  it('preserves disabled and one-way connections', () => {
    expect(resolveAnsiblexEdges([{ ...link, enabled: false }], planner(), 10, snapshot, graph, catalog, now)).toEqual([]);
    expect(resolveAnsiblexEdges([{ ...link, bidirectional: false }], planner(), 10, snapshot, graph, catalog, now)).toHaveLength(1);
  });
  it('drops obsolete ACL fields when importing earlier planner settings', () => {
    const imported = normalizeAnsiblexPlanner({ endpoints: { 1: { ownerAllianceId: 10, chargeTj: 350, access: 'denied' } } });
    expect(imported.endpoints[1]).toEqual({ ownerAllianceId: 10, chargeTj: 350, observedAt: undefined });
    expect(resolve(imported)[0].blocked).toBe(false);
  });

  it('keeps zone preferences while discarding removed Advanced settings on reload', () => {
    expect(normalizeAnsiblexZonePreferences({ maxZone: 3, showZoneOverlay: false,
      allianceId: 20, capitalOverrides: { 20: 4 }, fleet: [{ classId: '547', count: 1 }],
      fleetConfigured: true, endpoints: { 1: { ownerAllianceId: 20, chargeTj: 0 } },
    })).toEqual({ maxZone: 3, showZoneOverlay: false });
    expect(normalizeAnsiblexZonePreferences(null)).toEqual({ maxZone: 5, showZoneOverlay: true });
  });
});

describe('saved networks and itinerary', () => {
  it('preserves flags in legacy imports and full planner round trips', () => {
    const links = [{ ...link, enabled: false, bidirectional: false }];
    const state = planner(); state.endpoints[1].chargeTj = 0; state.endpoints[1].observedAt = now; state.capitalOverrides[10] = 9;
    const imported = importAnsiblexPlan(exportAnsiblexPlan(links, state));
    expect(imported.links).toEqual(links);
    expect(imported.planner).toEqual(normalizeAnsiblexPlanner(state));
    expect(importAnsiblexPlan(JSON.stringify(links))).toEqual({ links });
    expect(importAnsiblexPlan('[]').links).toEqual([]);
    expect(() => importAnsiblexPlan('{"format":"backroads-ansiblex","version":2}')).toThrow('Unsupported');
  });
  it('normalizes invalid inputs without making unknown classes free', () => {
    expect(normalizeAnsiblexLinks([{ from: NaN, to: 2 }, { from: 1, to: 1 }, link])).toEqual([{ ...link, enabled: true, bidirectional: true }]);
    const state = normalizeAnsiblexPlanner({ endpoints: { 1: { chargeTj: 2000 } }, fleet: [{ classId: 'unknown', count: 1 }, { classId: '963', count: -1 }] });
    expect(state.endpoints[1].chargeTj).toBe(1250);
    expect(fleetBaseCost(state.fleet, catalog)).toBeNull();
  });
  it('keeps post-bridge steps before the next waypoint bridge', () => {
    const makeRoute = (key: string, routeSteps: RouteStep[]): RouteOption => ({ key, steps: routeSteps, bridgeLegs: [], postBridgePaths: [], postBridgeJumps: 0, totalJumps: 1, totalBridges: 1 });
    const first = makeRoute('a', [{ kind: 'jump', fromId: 1, toId: 2 }, { kind: 'stargate', fromId: 2, toId: 3 }]);
    const second = makeRoute('b', [{ kind: 'ansiblex', fromId: 3, toId: 4 }, { kind: 'jump', fromId: 4, toId: 5 }]);
    expect(getItineraryIds(mergeWaypointRoute(first, second, [3]))).toEqual([1, 2, 3, 4, 5]);
  });
});
