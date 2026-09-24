import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAnsiblexSovereignty, parseSovereigntySystems, resolveAnsiblexMapReference, resolvePlanningAllianceId } from '../src/lib/ansiblexSovereignty';

const body = { solar_systems: [
  { solar_system_id: 1, claim: { alliance: { alliance_id: 10, is_capital_system: true } } },
  { solar_system_id: 2, claim: { alliance: { alliance_id: 10, is_capital_system: false } } },
  { solar_system_id: 3, claim: { unclaimed: true } },
  { solar_system_id: 4, claim: { faction: { faction_id: 20 } } },
  { solar_system_id: 5, claim: {} },
] };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('public sovereignty data', () => {
  it('distinguishes unknown claims, non-alliance claims, and capitals', () => {
    const data = parseSovereigntySystems(body, 1, 2);
    expect(data.owners).toEqual({ 1: 10, 2: 10, 3: null, 4: null });
    expect(data.capitals).toEqual({ 10: 1 });
    expect(() => parseSovereigntySystems({}, 1, 2)).toThrow('invalid');
  });
  it('treats conflicting capital flags as unknown', () => {
    const data = parseSovereigntySystems({ solar_systems: [body.solar_systems[0], { solar_system_id: 2, claim: { alliance: { alliance_id: 10, is_capital_system: true } } }] }, 1, 2);
    expect(data.capitals).toEqual({});
  });
  it('reuses a fresh cached response without a network request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const cached = parseSovereigntySystems(body, Date.now(), Date.now() + 300_000);
    expect(await loadAnsiblexSovereignty(cached)).toBe(cached);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the compatibility header and accounts for response cache age', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body), { headers: { 'Cache-Control': 'public, max-age=300', Age: '60' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 10, category: 'alliance', name: 'Test alliance' }])));
    vi.stubGlobal('fetch', fetch);
    const snapshot = await loadAnsiblexSovereignty(null);
    expect(snapshot.expiresAt).toBe(Date.now() + 240_000);
    expect(snapshot.fetchedAt).toBe(Date.now() - 60_000);
    expect(snapshot.allianceNames).toEqual({ 10: 'Test alliance' });
    expect(fetch.mock.calls[0][1].headers['X-Compatibility-Date']).toBe('2026-05-19');
  });
  it('honors Retry-After and does not repeatedly hit ESI during cooldown', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-23T13:00:00Z'));
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(loadAnsiblexSovereignty(null)).rejects.toMatchObject({ retryAt: Date.now() + 120_000 });
    await expect(loadAnsiblexSovereignty(null)).rejects.toThrow('pause');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('planning alliance inferred from Ansiblex sovereignty', () => {
  const now = 1000;
  const snapshot = { fetchedAt: 500, expiresAt: 1500,
    owners: { 1: 10, 2: 10, 3: 10, 4: 20, 5: 20, 6: null }, capitals: { 10: 1, 20: 4 } };

  it('uses the strict majority of distinct enabled endpoints', () => {
    const links = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5, enabled: false }];
    expect(resolvePlanningAllianceId(null, links, snapshot, now)).toBe(10);
    expect(resolvePlanningAllianceId(null, [...links, { from: 4, to: 5 }], snapshot, now)).toBe(10);
  });

  it('does not double-count gates repeated across links', () => {
    const links = [{ from: 1, to: 4 }, { from: 1, to: 5 }, { from: 2, to: 4 }];
    expect(resolvePlanningAllianceId(null, links, snapshot, now)).toBeNull();
  });

  it('requires a majority of all gates, including unknown and unclaimed endpoints', () => {
    expect(resolvePlanningAllianceId(null, [{ from: 1, to: 4 }, { from: 2, to: 5 }], snapshot, now)).toBeNull();
    expect(resolvePlanningAllianceId(null, [{ from: 1, to: 2 }, { from: 4, to: 6 }], snapshot, now)).toBeNull();
    expect(resolvePlanningAllianceId(null, [{ from: 1, to: 2 }, { from: 4, to: 7 }], snapshot, now)).toBeNull();
    expect(resolvePlanningAllianceId(null, [], snapshot, now)).toBeNull();
  });

  it('ignores expired sovereignty but honors an Advanced alliance override', () => {
    const links = [{ from: 1, to: 2 }];
    expect(resolvePlanningAllianceId(null, links, snapshot, 1500)).toBeNull();
    expect(resolvePlanningAllianceId(20, links, snapshot, now)).toBe(20);
    expect(resolvePlanningAllianceId(20, links, null, now)).toBe(20);
  });

  it('uses the character alliance only when there is no current network majority', () => {
    expect(resolvePlanningAllianceId(null, [{ from: 1, to: 2 }], snapshot, now, 20)).toBe(10);
    expect(resolvePlanningAllianceId(null, [], snapshot, now, 20)).toBe(20);
    expect(resolvePlanningAllianceId(null, [{ from: 1, to: 4 }], snapshot, now, 20)).toBe(20);
    expect(resolvePlanningAllianceId(null, [{ from: 1, to: 2 }], snapshot, 1500, 20)).toBe(20);
  });

  it('keeps a cached network overlay through refresh without using stale ownership for routing', () => {
    const planner = { allianceId: null, capitalOverrides: {} };
    const links = [{ from: 1, to: 2 }];
    expect(resolveAnsiblexMapReference(planner, links, snapshot, 20, now)).toEqual({
      allianceId: 10, capitalId: 1, source: 'Network majority', cached: false,
    });
    expect(resolveAnsiblexMapReference(planner, links, snapshot, 20, 1500)).toEqual({
      allianceId: 10, capitalId: 1, source: 'Network majority', cached: true,
    });
    expect(resolvePlanningAllianceId(null, links, snapshot, 1500)).toBeNull();
  });

  it('shows the character capital before links are imported, without inventing a capital', () => {
    const planner = { allianceId: null, capitalOverrides: {} };
    expect(resolveAnsiblexMapReference(planner, [], snapshot, 20, now)).toMatchObject({
      allianceId: 20, capitalId: 4, source: 'Character alliance',
    });
    expect(resolveAnsiblexMapReference(planner, [], snapshot, null, now).capitalId).toBeNull();
    expect(resolveAnsiblexMapReference(planner, [], null, 20, now).capitalId).toBeNull();
  });

  it('respects manual capital overrides even when sovereignty is unavailable', () => {
    const planner = { allianceId: 20, capitalOverrides: { 20: 8 } };
    expect(resolveAnsiblexMapReference(planner, [{ from: 1, to: 2 }], null, 10, now)).toEqual({
      allianceId: 20, capitalId: 8, source: 'Advanced override', cached: false,
    });
  });
});
