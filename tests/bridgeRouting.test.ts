import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeRoutes, computeTravelTree, initializeRouteGraph, type ComputeRequest } from '../src/workers/bridgePlannerWorker';
import { METERS_PER_LY } from '../src/lib/ansiblex';
import { getItineraryIds, normalizeBridgeCount } from '../src/lib/bridgeRoutes';

function graph(positions: number[], gates: Array<[number, number]> = []) {
  const systems = Object.fromEntries(positions.map((x, i) => [i + 1, {
    systemId: i + 1, regionId: 1, security: 0,
    position: { x: x * METERS_PER_LY, y: 0, z: 0 }, adjacentSystems: [] as number[],
  }]));
  for (const [a, b] of gates) { systems[a].adjacentSystems.push(b); systems[b].adjacentSystems.push(a); }
  return { systems };
}
function request(settings: ComputeRequest['settings'] = {}, destinationId = 4): ComputeRequest {
  return { type: 'compute', requestId: 1, stagingId: 1, destinationId, bridgeRange: 1.1, routesToShow: 5,
    settings: { bridgeCount: 1, bridgeFromStaging: true, allowAnsiblex: true, ansiblexes: [{ from: 2, to: 3, bidirectional: false }], ...settings } };
}
beforeEach(() => { vi.spyOn(console, 'debug').mockImplementation(() => {}); });

describe('directed travel trees', () => {
  it('uses outgoing edges forwards and incoming edges backwards', () => {
    initializeRouteGraph(graph([0, 1, 100, 101], [[3, 4]]));
    const settings = request().settings;
    expect(computeTravelTree(2, settings, 200).dist.get(4)).toBe(2);
    expect(computeTravelTree(4, settings, 200).dist.has(2)).toBe(false);
    expect(computeTravelTree(4, settings, 200, true).dist.get(2)).toBe(2);
  });
  it('distinguishes direction and eligibility changes in cache keys', () => {
    initializeRouteGraph(graph([0, 1, 100, 101], [[3, 4]]));
    const settings = request().settings;
    expect(computeTravelTree(4, settings, 200, true).dist.has(2)).toBe(true);
    expect(computeTravelTree(4, settings, 200).dist.has(2)).toBe(false);
    expect(computeTravelTree(4, { ...settings, ansiblexes: [] }, 200, true).dist.has(2)).toBe(false);
    initializeRouteGraph(graph([0, 1, 100, 101]));
    expect(computeTravelTree(4, settings, 200, true).dist.has(2)).toBe(false);
  });
  it('retains the actual stargate edge when an Ansiblex connects the same pair', () => {
    initializeRouteGraph(graph([0, 1, 100], [[2, 3]]));
    expect(computeTravelTree(2, request().settings, 200).prev.get(3)?.step.kind).toBe('stargate');
    expect(computeTravelTree(3, request().settings, 200, true).prev.get(2)?.step.kind).toBe('stargate');
  });
});

describe('bridge route construction', () => {
  it('preserves 0 and 3 bridge settings on reload and clamps invalid budgets', () => {
    expect([0, 1, 2, 3].map(normalizeBridgeCount)).toEqual([0, 1, 2, 3]);
    expect(normalizeBridgeCount(undefined)).toBe(1);
    expect(normalizeBridgeCount(NaN)).toBe(1);
    expect(normalizeBridgeCount(-1)).toBe(0);
    expect(normalizeBridgeCount(4)).toBe(3);
  });
  it('routes with no bridges and ignores bridge-specific restrictions at zero', () => {
    const data = graph([0, 1, 100, 101], [[1, 2], [3, 4]]);
    data.systems[1].security = 0.9;
    data.systems[4].security = 0.9;
    initializeRouteGraph(data);
    const payload = request({ bridgeCount: 0, bridgeIntoDestination: true, limitToCynoBeacons: true, cynoBeacons: [] });
    const result = computeRoutes(payload);
    expect(result.routes[0].totalBridges).toBe(0);
    expect(result.routes[0].bridgeLegs).toEqual([]);
    expect(result.routes[0].steps.map((step) => step.kind)).toEqual(['stargate', 'ansiblex', 'stargate']);
    expect(getItineraryIds(result.routes[0])).toEqual([1, 2, 3, 4]);
    expect(computeRoutes({ ...payload, settings: { ...payload.settings, allowAnsiblex: false } }).routes).toEqual([]);
    expect(computeRoutes({ ...payload, settings: { ...payload.settings, blacklistEnabled: true, blacklist: [{ id: 3 }] } }).routes).toEqual([]);
  });
  it('keeps a zero bridge budget for waypoints and worker segments', () => {
    initializeRouteGraph(graph([0, 1, 100, 101], [[1, 2], [3, 4]]));
    const payload = request({ bridgeCount: 0 });
    const route = computeRoutes({ ...payload, waypointIds: [2, 3] }).routes[0];
    expect(route.totalBridges).toBe(0);
    expect(getItineraryIds(route)).toEqual([1, 2, 3, 4]);
    const segment = computeRoutes({ ...payload, mode: 'waypoint-segment', totalBridgeBudget: 0 });
    expect(segment.routes.map((item) => item.totalBridges)).toEqual([0]);
    const shards = [0, 1, 2].flatMap((shardIndex) => computeRoutes({ ...payload, mode: 'pair-shard', shardIndex, shardCount: 3 }).routes);
    expect(shards).toEqual(computeRoutes(payload).routes);
  });
  it('builds three bridges with directed travel between them', () => {
    initializeRouteGraph(graph([0, 1, 50, 51, 100, 101, 150], [[6, 7]]));
    const payload = request({ bridgeCount: 3, ansiblexes: [
      { from: 2, to: 3, bidirectional: false }, { from: 4, to: 5, bidirectional: false },
    ] }, 7);
    const result = computeRoutes(payload);
    expect(result.routes[0].totalBridges).toBe(3);
    expect(result.routes[0].steps).toEqual([
      { kind: 'jump', fromId: 1, toId: 2 }, { kind: 'ansiblex', fromId: 2, toId: 3 },
      { kind: 'jump', fromId: 3, toId: 4 }, { kind: 'ansiblex', fromId: 4, toId: 5 },
      { kind: 'jump', fromId: 5, toId: 6 }, { kind: 'stargate', fromId: 6, toId: 7 },
    ]);
    expect(result.routes[0].totalJumps).toBe(3);
    const shards = [0, 1, 2].flatMap((shardIndex) => computeRoutes({ ...payload, mode: 'pair-shard', shardIndex, shardCount: 3 }).routes);
    expect(shards).toEqual(result.routes);
    expect(computeRoutes({ ...payload, settings: { ...payload.settings, bridgeContinuous: true } }).routes).toEqual([]);
    expect(computeRoutes({ ...payload, settings: { ...payload.settings, bridgeIntoDestination: true } }).routes).toEqual([]);
    expect(computeRoutes({ ...payload, settings: { ...payload.settings, ansiblexes: [
      { from: 2, to: 3, bidirectional: false }, { from: 5, to: 4, bidirectional: false },
    ] } }).routes).toEqual([]);
  });
  it('honors continuous bridges and beacon restrictions for all three landings', () => {
    initializeRouteGraph(graph([0, 1, 2, 3]));
    const payload = request({ bridgeCount: 3, bridgeContinuous: true, bridgeIntoDestination: true,
      limitToCynoBeacons: true, cynoBeacons: [{ id: 2 }, { id: 3 }, { id: 4 }] });
    const route = computeRoutes(payload).routes[0];
    expect(getItineraryIds(route)).toEqual([1, 2, 3, 4]);
    expect(route.bridgeLegs.map((leg) => leg.approachJumps)).toEqual([0, 0, 0]);
    expect(computeRoutes({ ...payload, settings: { ...payload.settings, cynoBeacons: [{ id: 2 }, { id: 4 }] } }).routes).toEqual([]);
  });
  it('allows three bridges in one waypoint segment and across the entire journey', () => {
    initializeRouteGraph(graph([0, 1, 50, 51, 100, 101, 150, 151], [[6, 7], [7, 8]]));
    const payload = request({ bridgeCount: 3, ansiblexes: [
      { from: 2, to: 3, bidirectional: false }, { from: 4, to: 5, bidirectional: false },
    ] }, 8);
    for (const waypointIds of [[7], [2, 3, 4, 5]]) {
      const route = computeRoutes({ ...payload, waypointIds }).routes[0];
      expect(route.totalBridges).toBe(3);
      expect(getItineraryIds(route)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }
    const segment = computeRoutes({ ...payload, mode: 'waypoint-segment', totalBridgeBudget: 3, destinationId: 7 });
    expect(segment.routes.some((route) => route.totalBridges === 3)).toBe(true);
  });
  it('builds an outgoing Ansiblex leg after a bridge using a reverse destination search', () => {
    initializeRouteGraph(graph([0, 1, 100, 101], [[3, 4]]));
    const result = computeRoutes(request());
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes[0].steps).toEqual([
      { kind: 'jump', fromId: 1, toId: 2 },
      { kind: 'ansiblex', fromId: 2, toId: 3 },
      { kind: 'stargate', fromId: 3, toId: 4 },
    ]);
    expect(computeRoutes(request({ ansiblexes: [{ from: 3, to: 2, bidirectional: false }] })).routes).toEqual([]);
  });
  it('records approach Ansiblexes before the jump', () => {
    initializeRouteGraph(graph([100, 1, 0]));
    const result = computeRoutes(request({ bridgeFromStaging: false, bridgeIntoDestination: true,
      ansiblexes: [{ from: 1, to: 2, bidirectional: false }] }, 3));
    expect(result.routes[0].steps).toEqual([{ kind: 'ansiblex', fromId: 1, toId: 2 }, { kind: 'jump', fromId: 2, toId: 3 }]);
  });
  it('uses incoming adjacency in the two-bridge backward search', () => {
    initializeRouteGraph(graph([0, 1, 50, 51, 100], [[4, 5]]));
    const result = computeRoutes(request({ bridgeCount: 2 }, 5));
    expect(result.routes[0].steps).toEqual([
      { kind: 'jump', fromId: 1, toId: 2 }, { kind: 'ansiblex', fromId: 2, toId: 3 },
      { kind: 'jump', fromId: 3, toId: 4 }, { kind: 'stargate', fromId: 4, toId: 5 },
    ]);
    expect(computeRoutes(request({ bridgeCount: 2, ansiblexes: [{ from: 3, to: 2, bidirectional: false }] }, 5)).routes).toEqual([]);
  });
  it('handles waypoint segments with only directed gate travel', () => {
    initializeRouteGraph(graph([0, 1, 50, 51], [[3, 4]]));
    const result = computeRoutes({ ...request({ bridgeFromStaging: false }), mode: 'waypoint-segment', totalBridgeBudget: 0, stagingId: 2, destinationId: 4 });
    expect(result.routes.find((route) => route.totalBridges === 0)?.steps).toEqual([{ kind: 'ansiblex', fromId: 2, toId: 3 }, { kind: 'stargate', fromId: 3, toId: 4 }]);
  });
  it('keeps waypoint order and bridge budget during worker combination', () => {
    initializeRouteGraph(graph([0, 1, 50, 51, 100], [[4, 5]]));
    const result = computeRoutes({ ...request({ bridgeCount: 2 }, 5), waypointIds: [2, 3] });
    expect(result.routes.length).toBeGreaterThan(0);
    expect(getItineraryIds(result.routes[0])).toEqual([1, 2, 3, 4, 5]);
    expect(result.routes[0].totalBridges).toBe(2);
  });
  it('produces identical typed steps in sharded and full results', () => {
    initializeRouteGraph(graph([0, 1, 100, 101], [[3, 4]]));
    const full = computeRoutes(request()).routes;
    const sharded = [0, 1].flatMap((shardIndex) => computeRoutes({ ...request(), mode: 'pair-shard', shardIndex, shardCount: 2 }).routes);
    expect(sharded).toEqual(full);
  });
  it('keeps bridge-only chains independent of Ansiblex links', () => {
    initializeRouteGraph(graph([0, 1, 2]));
    const result = computeRoutes(request({ bridgeOnlyChain: true, ansiblexes: [{ from: 1, to: 3 }] }, 3));
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes[0].steps.every((step) => step.kind === 'jump')).toBe(true);
    expect(getItineraryIds(result.routes[0])).toEqual([1, 2, 3]);
  });
  it('still honors blacklists and region restrictions', () => {
    initializeRouteGraph(graph([0, 1, 100, 101], [[3, 4]]));
    expect(computeRoutes(request({ blacklistEnabled: true, blacklist: [{ id: 3 }] })).routes).toEqual([]);
    const data = graph([0, 1, 100, 101], [[3, 4]]); data.systems[3].regionId = 2;
    initializeRouteGraph(data);
    expect(computeRoutes(request({ sameRegionOnly: true })).routes).toEqual([]);
  });
});
