import { useEffect, useMemo, useState } from 'react';
import {
  ANSIBLEX_PLANNER_STORAGE_KEY, emptyAnsiblexPlanner, fleetForPreset, loadAnsiblexRules,
  normalizeAnsiblexZonePreferences, resolveAnsiblexEdges,
  filterAnsiblexEdges,
  type AnsiblexLink, type AnsiblexZonePreferences, type AnsiblexRules, type PositionedGraph,
} from './ansiblex';
import { loadAnsiblexSovereignty, readSovereigntyCache, resolveAnsiblexMapReference, resolvePlanningAllianceId, SovereigntyRequestError } from './ansiblexSovereignty';

export function useAnsiblexPlanner(active: boolean, graph: PositionedGraph | null, links: AnsiblexLink[], preset: string, characterAllianceId: number | null) {
  const [state, setState] = useState<AnsiblexZonePreferences>(() => {
    try {
      return normalizeAnsiblexZonePreferences(JSON.parse(localStorage.getItem(ANSIBLEX_PLANNER_STORAGE_KEY) ?? 'null'));
    } catch {
      return normalizeAnsiblexZonePreferences(null);
    }
  });
  const [rules, setRules] = useState<AnsiblexRules | null>(null);
  const [snapshot, setSnapshot] = useState(readSovereigntyCache);
  const [now, setNow] = useState(Date.now);
  const [retryAt, setRetryAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(ANSIBLEX_PLANNER_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Planning remains available without persistent browser storage.
    }
  }, [state]);
  useEffect(() => {
    if (!active) return;
    const updateTime = () => setNow(Date.now());
    updateTime();
    const timer = window.setInterval(updateTime, 15_000);
    document.addEventListener('visibilitychange', updateTime);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', updateTime); };
  }, [active]);
  useEffect(() => {
    if (!active || !snapshot || snapshot.expiresAt <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), snapshot.expiresAt - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [active, snapshot]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    loadAnsiblexRules(controller.signal).then((data) => { setRules(data); setRulesError(null); }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setRulesError(reason instanceof Error ? reason.message : 'Unable to load Ansiblex rules.');
    });
    return () => controller.abort();
  }, [active]);
  const fresh = snapshot != null && now < snapshot.expiresAt;
  const retryReady = now >= retryAt;
  useEffect(() => {
    if (!active || fresh || !retryReady) return;
    const controller = new AbortController();
    loadAnsiblexSovereignty(snapshot, controller.signal).then((data) => {
      setSnapshot(data); setError(null); setRetryAt(data.expiresAt > Date.now() ? 0 : Date.now() + 60_000); setNow(Date.now());
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Sovereignty unavailable.');
      setRetryAt(reason instanceof SovereigntyRequestError ? reason.retryAt : Date.now() + 60_000);
    });
    return () => controller.abort();
  }, [active, fresh, retryReady, snapshot]);
  const planner = useMemo(() => ({ ...emptyAnsiblexPlanner(), ...state, fleet: fleetForPreset(preset) }), [state, preset]);
  const usableSnapshot = fresh ? snapshot : null;
  const allianceId = useMemo(() => resolvePlanningAllianceId(null, links, usableSnapshot, now, characterAllianceId),
    [links, usableSnapshot, now, characterAllianceId]);
  const mapReference = useMemo(() => resolveAnsiblexMapReference(planner, links, snapshot, characterAllianceId, now),
    [planner, links, snapshot, characterAllianceId, now]);
  const edges = useMemo(() => graph && rules
    ? resolveAnsiblexEdges(links, planner, allianceId, usableSnapshot, graph, rules)
    : [], [links, planner, allianceId, usableSnapshot, graph, rules]);
  const linkKey = JSON.stringify(filterAnsiblexEdges(edges, state.maxZone)
    .map(({ from, to }) => ({ from, to, enabled: true, bidirectional: false })));
  const allowedLinks: AnsiblexLink[] = useMemo(() => JSON.parse(linkKey), [linkKey]);
  return { state, setState, mapReference, rules, snapshot, now, error, rulesError, edges, allowedLinks };
}
