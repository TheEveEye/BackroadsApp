import { describe, expect, it } from 'vitest';
import type { GraphData, SystemNode } from '../src/lib/data';
import {
  ADVANCED_LOGISTICS_NETWORK_TYPE_ID,
  METERS_PER_LIGHT_YEAR,
  createSovereigntyPlanFile,
  emptySovereigntyPlan,
  indexUpgradeDefinitions,
  parseSovereigntyPlanFile,
  validateSovereigntyPlanFile,
  type SovereigntyUpgradeDefinition,
} from '../src/lib/sovereigntyPlan';

const definition: SovereigntyUpgradeDefinition = {
  typeId: 10, name: 'Upgrade', description: '', category: 'Strategic',
  powerAllocation: 100, powerProduction: 0, workforceAllocation: 100,
  workforceProduction: 0, mutuallyExclusiveGroup: 'test',
};
const definitions = indexUpgradeDefinitions([
  definition,
  { ...definition, typeId: 11 },
  { ...definition, typeId: ADVANCED_LOGISTICS_NETWORK_TYPE_ID, mutuallyExclusiveGroup: undefined },
]);
function system(systemId: number, distance: number): SystemNode {
  return {
    systemId, constellationId: 1, regionId: 1,
    position: { x: distance * METERS_PER_LIGHT_YEAR, y: 0, z: 0 },
    power: 200, workforce: 200, magmaticGas: 0, superionicIce: 0,
    isSovereigntyEligible: true, adjacentSystems: [], hasObservatory: false, isRegional: false,
  };
}
const graph: GraphData = { systems: { 1: system(1, 0), 2: system(2, 5), 3: system(3, 6) } };
const file = () => createSovereigntyPlanFile({
  upgradesBySystem: {
    1: [{ typeId: ADVANCED_LOGISTICS_NETWORK_TYPE_ID }, { typeId: 10 }],
    2: [{ typeId: ADVANCED_LOGISTICS_NETWORK_TYPE_ID }],
  },
  ansiblexLinks: [{ id: '1-2', from: 1, to: 2 }],
}, new Set([2, 1]), 1);
const validate = (value: unknown, map = graph) => {
  const parsed = parseSovereigntyPlanFile(value);
  validateSovereigntyPlanFile(parsed, map, definitions);
  return parsed;
};

describe('sovereignty plan files', () => {
  it('round-trips territory, capital, upgrades and Ansiblex links through JSON', () => {
    const exported = file();
    expect(validate(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
  });
  it('allows an empty workspace', () => {
    expect(validate(createSovereigntyPlanFile(emptySovereigntyPlan(), new Set(), null)).plan)
      .toEqual(emptySovereigntyPlan());
  });
  it('restores plans with resource deficits after a generator is removed', () => {
    const lowPowerGraph = { systems: { ...graph.systems, 1: { ...graph.systems[1], power: 0, workforce: 0 } } };
    expect(() => validate(file(), lowPowerGraph)).not.toThrow();
  });
  it.each(['01', '1e0', ' 1 ', '+1', '__proto__'])('rejects a noncanonical system key %s instead of hiding upgrades', (key) => {
    const value = file();
    value.plan.upgradesBySystem = { [key]: [{ typeId: 10 }] };
    expect(() => validate(value)).toThrow('invalid system upgrades');
  });
  it.each([true, '1', null, 1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid territory IDs (%s)', (id) => {
    expect(() => validate({ ...file(), territorySystemIds: [id] })).toThrow('invalid territory');
  });
  it('rejects arrays in place of the upgrades object', () => {
    expect(() => validate({ ...file(), plan: { upgradesBySystem: [], ansiblexLinks: [] } })).toThrow('data is invalid');
  });
  it('rejects boolean or string upgrade IDs', () => {
    for (const typeId of [true, '10']) {
      expect(() => validate({ ...file(), plan: { upgradesBySystem: { 1: [{ typeId }] }, ansiblexLinks: [] } })).toThrow('invalid or duplicate upgrade');
    }
  });
  it('rejects unsupported versions', () => {
    expect(() => validate({ ...file(), version: 2 })).toThrow('not supported');
  });
  it('rejects duplicate upgrades', () => {
    const value = file();
    value.plan.upgradesBySystem[1].push({ typeId: 10 });
    expect(() => validate(value)).toThrow('duplicate upgrade');
  });
  it('rejects unknown upgrades and mutually exclusive upgrades', () => {
    for (const [typeId, message] of [[999, 'not available'], [11, 'conflicting upgrades']] as const) {
      const value = file();
      value.plan.upgradesBySystem[1].push({ typeId });
      expect(() => validate(value)).toThrow(message);
    }
  });
  it('rejects a capital or upgraded system outside the territory', () => {
    expect(() => validate({ ...file(), capitalSystemId: 3 })).toThrow('capital system is outside');
    const value = file();
    value.plan.upgradesBySystem[3] = [{ typeId: 10 }];
    expect(() => validate(value)).toThrow('outside the territory');
  });
  it('rejects ineligible or missing territory systems', () => {
    expect(() => validate({ ...file(), territorySystemIds: [1, 2, 99] })).toThrow('not a valid sovereignty system');
    expect(() => validate(file(), { systems: { ...graph.systems, 1: { ...graph.systems[1], isSovereigntyEligible: false } } })).toThrow('not a valid sovereignty system');
  });
  it('rejects duplicate links even with reversed endpoints', () => {
    const value = file();
    value.plan.ansiblexLinks.push({ id: 'different-id', from: 2, to: 1 });
    expect(() => validate(value)).toThrow('duplicate Ansiblex link');
  });
  it('rejects an endpoint shared by multiple links', () => {
    const value = file();
    value.territorySystemIds.push(3);
    value.plan.ansiblexLinks.push({ id: '2-3', from: 2, to: 3 });
    expect(() => validate(value)).toThrow('more than one');
  });
  it('rejects links beyond five light years', () => {
    const value = file();
    value.territorySystemIds.push(3);
    value.plan.ansiblexLinks = [{ id: '1-3', from: 1, to: 3 }];
    expect(() => validate(value)).toThrow('range limit');
  });
  it('rejects orphan Ansiblex upgrades and missing endpoint upgrades', () => {
    const value = file();
    value.plan.ansiblexLinks = [];
    expect(() => validate(value)).toThrow('without a link');
    const missing = file();
    delete missing.plan.upgradesBySystem[2];
    expect(() => validate(missing)).toThrow('missing its Ansiblex endpoint upgrade');
  });
});
