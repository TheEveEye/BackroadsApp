export const BRIDGE_COUNTS = [0, 1, 2, 3] as const;

export function normalizeBridgeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(3, Math.trunc(value))) : 1;
}

export type RouteStep = {
  kind: 'stargate' | 'ansiblex' | 'jump';
  fromId: number;
  toId: number;
};

export type RouteBridgeLeg = {
  parkingId: number;
  endpointId: number;
  approachPath: number[];
  approachJumps: number;
  bridgeLy: number;
};

export type RouteOption = {
  key: string;
  bridgeLegs: RouteBridgeLeg[];
  postBridgePaths: number[][];
  postBridgeJumps: number;
  totalJumps: number;
  totalBridges: number;
  waypointIds?: number[];
  steps: RouteStep[];
};

export function mergeWaypointRoute(prefix: RouteOption, route: RouteOption, waypointIds: number[]): RouteOption {
  return {
    key: prefix.key === 'root' ? route.key : `${prefix.key}__${route.key}`,
    bridgeLegs: [...prefix.bridgeLegs, ...route.bridgeLegs],
    postBridgePaths: [...prefix.postBridgePaths, ...route.postBridgePaths].filter((path) => path.length > 0 && path[0] !== -1),
    postBridgeJumps: prefix.postBridgeJumps + route.postBridgeJumps,
    totalJumps: prefix.totalJumps + route.totalJumps,
    totalBridges: prefix.totalBridges + route.totalBridges,
    waypointIds,
    steps: [...prefix.steps, ...route.steps],
  };
}

export function getItineraryIds(route: RouteOption): number[] {
  return route.steps.length ? [route.steps[0].fromId, ...route.steps.map((step) => step.toId)] : route.postBridgePaths.flat();
}

// Keep route cards compact while preserving the order of jumps and Ansiblex legs.
export function getRouteSummaryIds(route: RouteOption): number[] {
  const endpoints = route.steps.filter((step) => step.kind !== 'stargate').flatMap((step) => [step.fromId, step.toId]);
  const ids = route.steps.length ? [route.steps[0].fromId, ...endpoints, route.steps[route.steps.length - 1].toId] : getItineraryIds(route);
  return ids.filter((id, index) => index === 0 || id !== ids[index - 1]);
}
