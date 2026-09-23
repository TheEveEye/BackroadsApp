// Attribute 6364 is measured in GJ; the UI presents TJ.
export function buildAnsiblexRules(template, types, dogma, metadata) {
  const dogmaByType = new Map(dogma.map((row) => [Number(row._key), row]));
  const attribute = (typeId, attributeId) => dogmaByType.get(typeId)?.dogmaAttributes
    ?.find((row) => row.attributeID === attributeId)?.value;
  const classes = template.classes.map((shipClass) => {
    const members = types.filter((type) => type.published && type.groupID === shipClass.groupId);
    const costs = members.map((type) => attribute(Number(type._key), 6364));
    const known = [...new Set(costs.filter((cost) => typeof cost === 'number' && Number.isFinite(cost) && cost > 0))];
    if (shipClass.eligible && known.length > 1) {
      throw new Error(`${shipClass.name} has different per-hull activation costs; update the class catalog before exporting.`);
    }
    return { ...shipClass, baseCostTj: shipClass.eligible && members.length && costs.every((cost) => cost > 0) ? known[0] / 1000 : null,
      sampleTypeId: members.length ? Number(members[0]._key) : null };
  });
  if (classes.every((row) => row.baseCostTj == null)) throw new Error('SDE lacks Ansiblex activation costs. Download a post-22 September 2026 SDE.');
  const capacity = attribute(35841, 482);
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error('SDE lacks Ansiblex capacitor capacity.');
  return { ...template, capacityTj: capacity / 1000,
    source: { kind: 'sde', sdeBuild: metadata.buildNumber, retrievedAt: new Date().toISOString(),
      url: 'https://developers.eveonline.com/static-data', notes: 'Zones and eligibility follow the rulesDate release; costs and capacity come from SDE dogma.' }, classes };
}
