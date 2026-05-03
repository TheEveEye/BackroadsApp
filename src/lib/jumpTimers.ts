export type TimerMode = 'fastest-arrival' | 'jump-asap';

export type JumpTimerBridgeLeg = {
  parkingId: number;
  endpointId: number;
  bridgeLy: number;
};

export type JumpTimerRoute = {
  bridgeLegs: JumpTimerBridgeLeg[];
};

export type JumpTimerStop = {
  index: number;
  fromId: number;
  toId: number;
  bridgeLy: number;
  effectiveLy: number;
  activationMinutes: number;
  fatigueAfterJumpMinutes: number;
  waitBeforeNextMinutes: number | null;
  fatigueAtNextJumpMinutes: number;
  arrivalMinutes: number;
};

const FATIGUE_REDUCTION_OPTIONS = [0, 75, 90] as const;
const FATIGUE_OPTIMIZATION_STEP_MINUTES = 1;

export function clampFatigueReduction(value: number) {
  const finiteValue = Number.isFinite(value) ? value : 0;
  return FATIGUE_REDUCTION_OPTIONS.reduce((closest, option) =>
    Math.abs(option - finiteValue) < Math.abs(closest - finiteValue) ? option : closest
  );
}

export function calculateJumpTimerStops(
  route: JumpTimerRoute,
  fatigueReduction: number,
  startingFatigueMinutes = 0,
  startingActivationMinutes = 0,
  timerMode: TimerMode = 'jump-asap'
): JumpTimerStop[] {
  const reductionModifier = 1 - clampFatigueReduction(fatigueReduction) / 100;
  if (timerMode === 'fastest-arrival') {
    return calculateFastestArrivalTimerStops(route, reductionModifier, startingFatigueMinutes, startingActivationMinutes);
  }
  return calculateJumpAsapTimerStops(route, reductionModifier, startingFatigueMinutes, startingActivationMinutes);
}

function calculateLegTimers(effectiveLy: number, fatigueBeforeJump: number) {
  const activationMinutes = Math.min(30, Math.max(1 + effectiveLy, fatigueBeforeJump / 10));
  const fatigueAfterJumpMinutes = Math.min(
    300,
    Math.max(10 * (1 + effectiveLy), fatigueBeforeJump * (1 + effectiveLy))
  );
  return { activationMinutes, fatigueAfterJumpMinutes };
}

function calculateJumpAsapTimerStops(
  route: JumpTimerRoute,
  reductionModifier: number,
  startingFatigueMinutes: number,
  startingActivationMinutes: number
) {
  let fatigueBeforeJump = Math.max(0, startingFatigueMinutes - startingActivationMinutes);
  let arrivalMinutes = Math.max(0, startingActivationMinutes);
  return route.bridgeLegs.map((leg, index) => {
    const effectiveLy = leg.bridgeLy * reductionModifier;
    const { activationMinutes, fatigueAfterJumpMinutes } = calculateLegTimers(effectiveLy, fatigueBeforeJump);
    const waitBeforeNextMinutes = index < route.bridgeLegs.length - 1 ? activationMinutes : null;
    const fatigueAtNextJumpMinutes = waitBeforeNextMinutes == null
      ? fatigueAfterJumpMinutes
      : Math.max(0, fatigueAfterJumpMinutes - waitBeforeNextMinutes);
    const stop: JumpTimerStop = {
      index: index + 1,
      fromId: leg.parkingId,
      toId: leg.endpointId,
      bridgeLy: leg.bridgeLy,
      effectiveLy,
      activationMinutes,
      fatigueAfterJumpMinutes,
      waitBeforeNextMinutes,
      fatigueAtNextJumpMinutes,
      arrivalMinutes,
    };
    fatigueBeforeJump = fatigueAtNextJumpMinutes;
    if (waitBeforeNextMinutes != null) {
      arrivalMinutes += waitBeforeNextMinutes;
    }
    return stop;
  });
}

function calculateFastestArrivalTimerStops(
  route: JumpTimerRoute,
  reductionModifier: number,
  startingFatigueMinutes: number,
  startingActivationMinutes: number
) {
  const effectiveLys = route.bridgeLegs.map((leg) => leg.bridgeLy * reductionModifier);
  const memo = new Map<string, { cost: number; waitBeforeJump: number; fatigueBeforeJump: number }>();

  const quantize = (value: number) =>
    Math.max(0, Math.min(300, Math.round(value / FATIGUE_OPTIMIZATION_STEP_MINUTES) * FATIGUE_OPTIMIZATION_STEP_MINUTES));
  const memoKey = (legIndex: number, fatigue: number, activation: number) =>
    `${legIndex}:${quantize(fatigue).toFixed(2)}:${Math.max(0, Math.min(30, activation)).toFixed(2)}`;
  const candidateFatigues = (maxFatigue: number) => {
    if (maxFatigue <= 0) return [0];
    const values = new Set<number>([0, maxFatigue, Math.min(10, maxFatigue)]);
    for (let value = FATIGUE_OPTIMIZATION_STEP_MINUTES; value < maxFatigue; value += FATIGUE_OPTIMIZATION_STEP_MINUTES) {
      values.add(value);
    }
    return Array.from(values).sort((a, b) => b - a);
  };

  const bestFrom = (legIndex: number, currentFatigue: number, activationRemaining: number): { cost: number; waitBeforeJump: number; fatigueBeforeJump: number } => {
    const fatigue = quantize(currentFatigue);
    const activation = Math.max(0, Math.min(30, activationRemaining));
    const key = memoKey(legIndex, fatigue, activation);
    const cached = memo.get(key);
    if (cached) return cached;

    if (legIndex >= route.bridgeLegs.length) {
      const done = { cost: 0, waitBeforeJump: 0, fatigueBeforeJump: fatigue };
      memo.set(key, done);
      return done;
    }

    if (legIndex === route.bridgeLegs.length - 1) {
      const finalWait = activation;
      const result = {
        cost: finalWait,
        waitBeforeJump: finalWait,
        fatigueBeforeJump: Math.max(0, fatigue - finalWait),
      };
      memo.set(key, result);
      return result;
    }

    const maxPreJumpFatigue = Math.max(0, fatigue - activation);
    let best = {
      cost: Number.POSITIVE_INFINITY,
      waitBeforeJump: activation,
      fatigueBeforeJump: Math.max(0, fatigue - activation),
    };

    for (const fatigueBeforeJump of candidateFatigues(maxPreJumpFatigue)) {
      const waitBeforeJump = fatigueBeforeJump <= 0
        ? Math.max(activation, fatigue)
        : fatigue - fatigueBeforeJump;
      if (waitBeforeJump + 0.0001 < activation) continue;
      const timers = calculateLegTimers(effectiveLys[legIndex] ?? 0, fatigueBeforeJump);
      const future = bestFrom(legIndex + 1, timers.fatigueAfterJumpMinutes, timers.activationMinutes);
      const cost = waitBeforeJump + future.cost;
      if (cost < best.cost) {
        best = { cost, waitBeforeJump, fatigueBeforeJump };
      }
    }

    memo.set(key, best);
    return best;
  };

  const stops: JumpTimerStop[] = [];
  let currentFatigue = Math.max(0, Math.min(300, startingFatigueMinutes));
  let activationRemaining = Math.max(0, Math.min(30, startingActivationMinutes));
  let arrivalMinutes = 0;

  for (let index = 0; index < route.bridgeLegs.length; index += 1) {
    const leg = route.bridgeLegs[index];
    const decision = bestFrom(index, currentFatigue, activationRemaining);
    arrivalMinutes += decision.waitBeforeJump;
    const effectiveLy = effectiveLys[index] ?? 0;
    const { activationMinutes, fatigueAfterJumpMinutes } = calculateLegTimers(effectiveLy, decision.fatigueBeforeJump);
    const nextDecision = index < route.bridgeLegs.length - 1
      ? bestFrom(index + 1, fatigueAfterJumpMinutes, activationMinutes)
      : null;
    const waitBeforeNextMinutes = nextDecision?.waitBeforeJump ?? null;
    const fatigueAtNextJumpMinutes = waitBeforeNextMinutes == null
      ? fatigueAfterJumpMinutes
      : Math.max(0, fatigueAfterJumpMinutes - waitBeforeNextMinutes);
    stops.push({
      index: index + 1,
      fromId: leg.parkingId,
      toId: leg.endpointId,
      bridgeLy: leg.bridgeLy,
      effectiveLy,
      activationMinutes,
      fatigueAfterJumpMinutes,
      waitBeforeNextMinutes,
      fatigueAtNextJumpMinutes,
      arrivalMinutes,
    });
    currentFatigue = fatigueAfterJumpMinutes;
    activationRemaining = activationMinutes;
  }

  return stops;
}

export function getRouteTravelMinutes(timerStops: JumpTimerStop[]) {
  return timerStops[timerStops.length - 1]?.arrivalMinutes ?? 0;
}
