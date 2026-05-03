import { calculateJumpTimerStops, getRouteTravelMinutes, type JumpTimerStop, type TimerMode } from '../lib/jumpTimers';

type BridgeLeg = {
  parkingId: number;
  endpointId: number;
  bridgeLy: number;
};

type TimerRoute = {
  key: string;
  bridgeLegs: BridgeLeg[];
};

type ComputeRequest = {
  type: 'compute';
  requestId: number;
  routes: TimerRoute[];
  selectedRouteKey: string | null;
  fatigueReduction: number;
  startingFatigueMinutes: number;
  startingActivationMinutes: number;
  timerMode: TimerMode;
};

type RouteResponse = {
  type: 'route';
  requestId: number;
  routeKey: string;
  travelMinutes: number;
  timerStops?: JumpTimerStop[];
};

type DoneResponse = {
  type: 'done';
  requestId: number;
};

self.onmessage = (event: MessageEvent<ComputeRequest>) => {
  const payload = event.data;
  if (payload.type !== 'compute') return;

  const selectedRoute = payload.selectedRouteKey
    ? payload.routes.find((route) => route.key === payload.selectedRouteKey) ?? null
    : null;
  const routes = selectedRoute
    ? [selectedRoute, ...payload.routes.filter((route) => route.key !== selectedRoute.key)]
    : payload.routes;

  for (const route of routes) {
    const timerStops = calculateJumpTimerStops(
      route,
      payload.fatigueReduction,
      payload.startingFatigueMinutes,
      payload.startingActivationMinutes,
      payload.timerMode
    );
    const response: RouteResponse = {
      type: 'route',
      requestId: payload.requestId,
      routeKey: route.key,
      travelMinutes: getRouteTravelMinutes(timerStops),
      timerStops: route.key === payload.selectedRouteKey ? timerStops : undefined,
    };
    self.postMessage(response);
  }

  const response: DoneResponse = {
    type: 'done',
    requestId: payload.requestId,
  };
  self.postMessage(response);
};
