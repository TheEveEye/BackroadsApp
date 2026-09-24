import { expect, it } from 'vitest';
import { buildAnsiblexRules } from '../scripts/ansiblex-data.mjs';

it('exports SDE provenance and converts GJ to TJ', () => {
  const template = { rulesDate: '2026-09-22', classes: [{ id: '883', name: 'Rorqual', groupId: 883, eligible: true }] };
  const types = [{ _key: 28352, published: true, groupID: 883 }];
  const dogma = [{ _key: 28352, dogmaAttributes: [{ attributeID: 6364, value: 19000 }] }, { _key: 35841, dogmaAttributes: [{ attributeID: 482, value: 1250000 }] }];
  const output = buildAnsiblexRules(template, types, dogma, { buildNumber: 123 });
  expect(output.classes[0].baseCostTj).toBe(19);
  expect(output.capacityTj).toBe(1250);
  expect(output.source).toMatchObject({ kind: 'sde', sdeBuild: 123 });
  expect(() => buildAnsiblexRules(template, types, [], {})).toThrow('post-22 September');
});

it('refuses to hide different per-hull costs under a single class cost', () => {
  const template = { classes: [{ id: '883', name: 'Rorqual', groupId: 883, eligible: true }] };
  const types = [1, 2].map((_key) => ({ _key, published: true, groupID: 883 }));
  const dogma = [1, 2].map((_key) => ({ _key, dogmaAttributes: [{ attributeID: 6364, value: _key * 19000 }] }));
  expect(() => buildAnsiblexRules(template, types, dogma, {})).toThrow('different per-hull');
});
