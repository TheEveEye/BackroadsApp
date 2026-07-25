import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutocompleteInput,
  type AutocompleteItem,
} from '../components/AutocompleteInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { SegmentedSlider } from '../components/SegmentedSlider';
import {
  SovereigntyPlannerMap,
  type TerritoryEditTool,
} from '../components/SovereigntyPlannerMap';
import { SovereigntyUpgradePicker } from '../components/SovereigntyUpgradePicker';
import type { GraphData } from '../lib/data';
import { getSovereigntySecurityColor } from '../lib/security';
import { loadSovereigntyHolders, type SovereigntyHolder } from '../lib/sovereignty';
import {
  ADVANCED_LOGISTICS_NETWORK_TYPE_ID,
  ANSIBLEX_MAX_RANGE_LY,
  SOVEREIGNTY_PLAN_STORAGE_KEY,
  calculateSovereigntyPlan,
  calculateSystemResources,
  canonicalAnsiblexId,
  emptySovereigntyPlan,
  getAnsiblexDistanceLy,
  getPlacementPowerBlockReason,
  getSovereigntyUpgradeIconUrl,
  indexUpgradeDefinitions,
  loadSovereigntyUpgradeDefinitions,
  normalizeSovereigntyPlan,
  removeSystemsFromPlan,
  type SovereigntyPlan,
  type SovereigntyUpgradeDefinition,
} from '../lib/sovereigntyPlan';

type AppWindow = Window & {
  appGraph?: GraphData;
};

type PendingConfirmation =
  | { kind: 'territory'; nextIds: number[]; removedIds: number[] }
  | { kind: 'replace'; systemId: number; currentTypeId: number; nextTypeId: number }
  | { kind: 'remove-link'; linkId: string }
  | { kind: 'clear-plan' };

type InspectorTab = 'system' | 'workforce' | 'routing';

const SOVEREIGNTY_UI_STORAGE_KEY = 'br.sovereigntyPlanner.ui.v1';
const INSPECTOR_TABS = [
  { label: 'System', value: 'system' },
  { label: 'Workforce', value: 'workforce' },
  { label: 'Routing', value: 'routing' },
];

function loadStoredUiState() {
  const emptyState = {
    selectedSystemIds: new Set<number>(),
    capitalSystemId: null as number | null,
  };
  if (typeof window === 'undefined') return emptyState;
  try {
    const parsed = JSON.parse(localStorage.getItem(SOVEREIGNTY_UI_STORAGE_KEY) ?? '');
    if (!Array.isArray(parsed?.selectedSystemIds)) return emptyState;
    const capitalSystemId = Number(parsed.capitalSystemId);
    return {
      selectedSystemIds: new Set<number>(
        parsed.selectedSystemIds
        .map(Number)
        .filter((id: number) => Number.isInteger(id) && id > 0),
      ),
      capitalSystemId: Number.isInteger(capitalSystemId) && capitalSystemId > 0
        ? capitalSystemId
        : null,
    };
  } catch {
    return emptyState;
  }
}

function loadStoredPlan() {
  if (typeof window === 'undefined') return emptySovereigntyPlan();
  try {
    return normalizeSovereigntyPlan(
      JSON.parse(localStorage.getItem(SOVEREIGNTY_PLAN_STORAGE_KEY) ?? ''),
    );
  } catch {
    return emptySovereigntyPlan();
  }
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString();
}

function ResourceLine({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warn' | 'good';
}) {
  const toneClass = tone === 'warn'
    ? 'text-red-600 dark:text-red-400'
    : tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-slate-800 dark:text-slate-200';
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`font-medium tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

export function SovereigntyPlanner() {
  const [graph, setGraph] = useState<GraphData | null>(() => (
    (window as AppWindow).appGraph ?? null
  ));
  const storedUiStateRef = useRef(loadStoredUiState());
  const hasValidatedStoredSelectionRef = useRef(false);
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<number>>(
    () => new Set(storedUiStateRef.current.selectedSystemIds),
  );
  const [capitalSystemId, setCapitalSystemId] = useState<number | null>(
    storedUiStateRef.current.capitalSystemId,
  );
  const [plan, setPlan] = useState<SovereigntyPlan>(loadStoredPlan);
  const [definitions, setDefinitions] = useState<SovereigntyUpgradeDefinition[]>([]);
  const [definitionStatus, setDefinitionStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeUpgradeTypeId, setActiveUpgradeTypeId] = useState<number | null>(null);
  const [pendingAnsiblexFrom, setPendingAnsiblexFrom] = useState<number | null>(null);
  const [selectedPlanSystemId, setSelectedPlanSystemId] = useState<number | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('system');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [territoryEditing, setTerritoryEditing] = useState(false);
  const [territoryEditTool, setTerritoryEditTool] = useState<TerritoryEditTool>('territory');
  const [fitSelectionRequest, setFitSelectionRequest] = useState(0);
  const [sovereigntyHolders, setSovereigntyHolders] = useState<SovereigntyHolder[]>([]);
  const [holderStatus, setHolderStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    const syncGraph = () => {
      const loadedGraph = (window as AppWindow).appGraph;
      if (loadedGraph) setGraph(loadedGraph);
    };
    syncGraph();
    window.addEventListener('graph-loaded', syncGraph);
    return () => window.removeEventListener('graph-loaded', syncGraph);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDefinitionStatus('loading');
    loadSovereigntyUpgradeDefinitions(controller.signal)
      .then((nextDefinitions) => {
        setDefinitions(nextDefinitions);
        setDefinitionStatus('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDefinitions([]);
        setDefinitionStatus('error');
      });
    return () => controller.abort();
  }, []);

  const definitionsById = useMemo(() => indexUpgradeDefinitions(definitions), [definitions]);
  const advancedLogisticsNetwork = definitionsById.get(ADVANCED_LOGISTICS_NETWORK_TYPE_ID);
  const activeDefinition = activeUpgradeTypeId == null
    ? null
    : definitionsById.get(activeUpgradeTypeId) ?? null;
  const placementMode = activeDefinition?.typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID
    ? 'ansiblex'
    : activeDefinition
      ? 'upgrade'
      : 'neutral';
  const planSummary = useMemo(
    () => calculateSovereigntyPlan(graph, plan, definitions, selectedSystemIds),
    [definitions, graph, plan, selectedSystemIds],
  );

  const eligibleSystemIds = useMemo(() => {
    const ids = new Set<number>();
    if (!graph) return ids;
    for (const system of Object.values(graph.systems)) {
      if (system.isSovereigntyEligible) ids.add(system.systemId);
    }
    return ids;
  }, [graph]);

  useEffect(() => {
    if (!graph || hasValidatedStoredSelectionRef.current) return;
    hasValidatedStoredSelectionRef.current = true;
    const validated = new Set(
      Array.from(storedUiStateRef.current.selectedSystemIds)
        .filter((id) => eligibleSystemIds.has(id)),
    );
    setSelectedSystemIds(validated);
    setCapitalSystemId((current) => (
      current != null && validated.has(current) ? current : null
    ));
    if (validated.size > 0) setFitSelectionRequest((request) => request + 1);
    else {
      setTerritoryEditTool('territory');
      setTerritoryEditing(true);
    }
  }, [eligibleSystemIds, graph]);

  useEffect(() => {
    try {
      localStorage.setItem(SOVEREIGNTY_UI_STORAGE_KEY, JSON.stringify({
        selectedSystemIds: Array.from(selectedSystemIds).sort((a, b) => a - b),
        capitalSystemId,
      }));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }, [capitalSystemId, selectedSystemIds]);

  useEffect(() => {
    try {
      localStorage.setItem(SOVEREIGNTY_PLAN_STORAGE_KEY, JSON.stringify(plan));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }, [plan]);

  useEffect(() => {
    if (!graph || eligibleSystemIds.size === 0) return;
    const controller = new AbortController();
    setHolderStatus('loading');
    loadSovereigntyHolders(eligibleSystemIds, controller.signal)
      .then((holders) => {
        setSovereigntyHolders(holders);
        setHolderStatus('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSovereigntyHolders([]);
        setHolderStatus('error');
      });
    return () => controller.abort();
  }, [eligibleSystemIds, graph]);

  useEffect(() => {
    if (territoryEditing || activeUpgradeTypeId == null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (pendingAnsiblexFrom != null) setPendingAnsiblexFrom(null);
      else setActiveUpgradeTypeId(null);
      setNotice(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeUpgradeTypeId, pendingAnsiblexFrom, territoryEditing]);

  const selectionIndex = useMemo(() => {
    const items: AutocompleteItem[] = [];
    const systemIdsByKey = new Map<string, number[]>();
    if (!graph) return { items, systemIdsByKey };
    const eligibleByConstellation = new Map<number, number[]>();
    const eligibleByRegion = new Map<number, number[]>();
    for (const id of eligibleSystemIds) {
      const system = graph.systems[String(id)];
      if (!system) continue;
      const name = graph.namesById?.[String(id)] ?? String(id);
      const regionName = graph.regionsById?.[String(system.regionId)] ?? String(system.regionId);
      items.push({ id, name, kind: 'system', regionName, meta: regionName });
      systemIdsByKey.set(`system:${id}`, [id]);
      const constellationSystems = eligibleByConstellation.get(system.constellationId) ?? [];
      constellationSystems.push(id);
      eligibleByConstellation.set(system.constellationId, constellationSystems);
      const regionSystems = eligibleByRegion.get(system.regionId) ?? [];
      regionSystems.push(id);
      eligibleByRegion.set(system.regionId, regionSystems);
    }
    for (const [constellationId, systemIds] of eligibleByConstellation) {
      const firstSystem = graph.systems[String(systemIds[0])];
      const regionName = firstSystem
        ? graph.regionsById?.[String(firstSystem.regionId)] ?? String(firstSystem.regionId)
        : '';
      items.push({
        id: constellationId,
        name: graph.constellationsById?.[String(constellationId)] ?? String(constellationId),
        kind: 'constellation',
        regionName,
        meta: `${systemIds.length} systems · ${regionName}`,
      });
      systemIdsByKey.set(`constellation:${constellationId}`, systemIds);
    }
    for (const [regionId, systemIds] of eligibleByRegion) {
      items.push({
        id: regionId,
        name: graph.regionsById?.[String(regionId)] ?? String(regionId),
        kind: 'region',
        meta: `${systemIds.length} systems`,
      });
      systemIdsByKey.set(`region:${regionId}`, systemIds);
    }
    for (const holder of sovereigntyHolders) {
      const systemIds = holder.systemIds.filter((id) => eligibleSystemIds.has(id));
      if (systemIds.length === 0) continue;
      items.push({
        id: holder.id,
        name: holder.name,
        kind: holder.kind,
        meta: holder.kind === 'corporation'
          ? `${systemIds.length} alliance systems`
          : `${systemIds.length} systems`,
      });
      systemIdsByKey.set(`${holder.kind}:${holder.id}`, systemIds);
    }
    return { items, systemIdsByKey };
  }, [eligibleSystemIds, graph, sovereigntyHolders]);

  const holdingAllianceIdsBySystemId = useMemo(() => {
    const allianceIdsBySystemId = new Map<number, number>();
    for (const holder of sovereigntyHolders) {
      if (holder.kind !== 'alliance') continue;
      for (const systemId of holder.systemIds) allianceIdsBySystemId.set(systemId, holder.id);
    }
    return allianceIdsBySystemId;
  }, [sovereigntyHolders]);

  const systemHasPlan = useCallback((systemId: number) => (
    (plan.upgradesBySystem[String(systemId)]?.length ?? 0) > 0
    || plan.ansiblexLinks.some((link) => link.from === systemId || link.to === systemId)
  ), [plan]);

  const requestSelectionChange = useCallback((next: Set<number>) => {
    const removedIds = Array.from(selectedSystemIds)
      .filter((id) => !next.has(id) && systemHasPlan(id));
    if (removedIds.length > 0) {
      setPendingConfirmation({
        kind: 'territory',
        nextIds: Array.from(next),
        removedIds,
      });
      return;
    }
    setSelectedSystemIds(next);
    setCapitalSystemId((current) => (
      current != null && !next.has(current) ? null : current
    ));
  }, [selectedSystemIds, systemHasPlan]);

  const applySmartGroupToggle = useCallback((systemIds: readonly number[], requestFit: boolean) => {
    const eligibleIds = systemIds.filter((id) => eligibleSystemIds.has(id));
    if (eligibleIds.length === 0) return;
    const next = new Set(selectedSystemIds);
    const removeGroup = eligibleIds.every((id) => next.has(id));
    for (const id of eligibleIds) {
      if (removeGroup) next.delete(id);
      else next.add(id);
    }
    requestSelectionChange(next);
    if (requestFit && !removeGroup) setFitSelectionRequest((request) => request + 1);
  }, [eligibleSystemIds, requestSelectionChange, selectedSystemIds]);

  const handleAutocompleteSelect = useCallback((item: AutocompleteItem) => {
    if (!item.kind) return;
    applySmartGroupToggle(
      selectionIndex.systemIdsByKey.get(`${item.kind}:${item.id}`) ?? [],
      true,
    );
    setSearchQuery('');
  }, [applySmartGroupToggle, selectionIndex.systemIdsByKey]);

  const handleLassoSelection = useCallback((systemIds: number[]) => {
    if (territoryEditing && territoryEditTool === 'territory') {
      applySmartGroupToggle(systemIds, false);
    }
  }, [applySmartGroupToggle, territoryEditTool, territoryEditing]);

  const toggleTerritorySystem = useCallback((systemId: number) => {
    if (
      !territoryEditing
      || territoryEditTool !== 'territory'
      || !eligibleSystemIds.has(systemId)
    ) return;
    const next = new Set(selectedSystemIds);
    if (next.has(systemId)) next.delete(systemId);
    else next.add(systemId);
    requestSelectionChange(next);
  }, [
    eligibleSystemIds,
    requestSelectionChange,
    selectedSystemIds,
    territoryEditTool,
    territoryEditing,
  ]);

  const selectCapitalSystem = useCallback((systemId: number) => {
    if (
      !territoryEditing
      || territoryEditTool !== 'capital'
      || !eligibleSystemIds.has(systemId)
      || !selectedSystemIds.has(systemId)
    ) return;
    setCapitalSystemId((current) => current === systemId ? null : systemId);
  }, [
    eligibleSystemIds,
    selectedSystemIds,
    territoryEditTool,
    territoryEditing,
  ]);

  const addUpgrade = useCallback((
    systemId: number,
    typeId: number,
    replaceTypeId?: number,
  ) => {
    setPlan((current) => {
      const key = String(systemId);
      const currentUpgrades = current.upgradesBySystem[key] ?? [];
      if (currentUpgrades.some((upgrade) => upgrade.typeId === typeId)) return current;
      const nextUpgrades = replaceTypeId == null
        ? currentUpgrades
        : currentUpgrades.filter((upgrade) => upgrade.typeId !== replaceTypeId);
      return {
        ...current,
        upgradesBySystem: {
          ...current.upgradesBySystem,
          [key]: [...nextUpgrades, { typeId }],
        },
      };
    });
  }, []);

  const endpointUsed = useCallback((systemId: number) => (
    plan.ansiblexLinks.some((link) => link.from === systemId || link.to === systemId)
  ), [plan.ansiblexLinks]);

  const validatePower = useCallback((
    systemId: number,
    definition: SovereigntyUpgradeDefinition,
  ) => {
    const system = graph?.systems[String(systemId)];
    if (!system) return 'System data is unavailable.';
    return getPlacementPowerBlockReason(
      system,
      plan.upgradesBySystem[String(systemId)] ?? [],
      definition,
      definitionsById,
    );
  }, [definitionsById, graph, plan.upgradesBySystem]);

  const handleAnsiblexEndpoint = useCallback((systemId: number) => {
    if (!graph || !advancedLogisticsNetwork) return;
    if (pendingAnsiblexFrom === systemId) {
      setPendingAnsiblexFrom(null);
      setNotice(null);
      return;
    }
    if (endpointUsed(systemId)) {
      setNotice('That system already has an Ansiblex endpoint.');
      return;
    }
    const powerBlock = validatePower(systemId, advancedLogisticsNetwork);
    if (powerBlock) {
      setNotice(powerBlock);
      return;
    }
    if (pendingAnsiblexFrom == null) {
      setPendingAnsiblexFrom(systemId);
      setNotice('Choose the second Ansiblex endpoint.');
      return;
    }
    const distance = getAnsiblexDistanceLy(graph, pendingAnsiblexFrom, systemId);
    if (distance > ANSIBLEX_MAX_RANGE_LY) {
      setNotice(
        `That link is ${distance.toFixed(1)} ly; Ansiblex links cannot exceed ${ANSIBLEX_MAX_RANGE_LY} ly.`,
      );
      return;
    }
    const id = canonicalAnsiblexId(pendingAnsiblexFrom, systemId);
    setPlan((current) => {
      const upgradesBySystem = { ...current.upgradesBySystem };
      for (const endpoint of [pendingAnsiblexFrom, systemId]) {
        const key = String(endpoint);
        const upgrades = upgradesBySystem[key] ?? [];
        upgradesBySystem[key] = upgrades.some(
          (upgrade) => upgrade.typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID,
        )
          ? upgrades
          : [...upgrades, { typeId: ADVANCED_LOGISTICS_NETWORK_TYPE_ID }];
      }
      return {
        upgradesBySystem,
        ansiblexLinks: [...current.ansiblexLinks, {
          id,
          from: pendingAnsiblexFrom,
          to: systemId,
        }],
      };
    });
    setPendingAnsiblexFrom(null);
    setSelectedLinkId(id);
    setSelectedPlanSystemId(null);
    setNotice(`Created a ${distance.toFixed(1)} ly Ansiblex link.`);
  }, [
    advancedLogisticsNetwork,
    endpointUsed,
    graph,
    pendingAnsiblexFrom,
    validatePower,
  ]);

  const handlePlanSystemClick = useCallback((systemId: number) => {
    if (!selectedSystemIds.has(systemId)) {
      setNotice('Upgrades can only be placed inside the selected territory.');
      return;
    }
    if (!activeDefinition) {
      setSelectedPlanSystemId(systemId);
      setSelectedLinkId(null);
      setInspectorTab('system');
      setNotice(null);
      return;
    }
    if (activeDefinition.typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID) {
      handleAnsiblexEndpoint(systemId);
      return;
    }
    const currentUpgrades = plan.upgradesBySystem[String(systemId)] ?? [];
    if (currentUpgrades.some((upgrade) => upgrade.typeId === activeDefinition.typeId)) {
      setNotice(`${activeDefinition.name} is already planned in this system.`);
      return;
    }
    const powerBlock = validatePower(systemId, activeDefinition);
    if (powerBlock) {
      setNotice(powerBlock);
      return;
    }
    const conflict = activeDefinition.mutuallyExclusiveGroup
      ? currentUpgrades.find((upgrade) => (
        definitionsById.get(upgrade.typeId)?.mutuallyExclusiveGroup
        === activeDefinition.mutuallyExclusiveGroup
      ))
      : undefined;
    if (conflict) {
      setPendingConfirmation({
        kind: 'replace',
        systemId,
        currentTypeId: conflict.typeId,
        nextTypeId: activeDefinition.typeId,
      });
      return;
    }
    addUpgrade(systemId, activeDefinition.typeId);
    setSelectedPlanSystemId(systemId);
    setSelectedLinkId(null);
    setInspectorTab('system');
    setNotice(`${activeDefinition.name} added.`);
  }, [
    activeDefinition,
    addUpgrade,
    definitionsById,
    handleAnsiblexEndpoint,
    plan.upgradesBySystem,
    selectedSystemIds,
    validatePower,
  ]);

  const placementBlockedReasons = useMemo(() => {
    const reasons = new Map<number, string>();
    if (!graph || !activeDefinition) return reasons;
    for (const systemId of selectedSystemIds) {
      if (
        activeDefinition.typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID
        && endpointUsed(systemId)
      ) {
        reasons.set(systemId, 'This system already has an Ansiblex endpoint.');
        continue;
      }
      const reason = validatePower(systemId, activeDefinition);
      if (reason) reasons.set(systemId, reason);
      if (
        pendingAnsiblexFrom != null
        && activeDefinition.typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID
      ) {
        if (systemId === pendingAnsiblexFrom) {
          reasons.set(systemId, 'Choose a different system for the second endpoint.');
        } else {
          const distance = getAnsiblexDistanceLy(graph, pendingAnsiblexFrom, systemId);
          if (distance > ANSIBLEX_MAX_RANGE_LY) {
          reasons.set(systemId, `Out of range (${distance.toFixed(1)} ly).`);
          }
        }
      }
    }
    return reasons;
  }, [
    activeDefinition,
    endpointUsed,
    graph,
    pendingAnsiblexFrom,
    selectedSystemIds,
    validatePower,
  ]);

  const removeLink = useCallback((linkId: string) => {
    setPlan((current) => {
      const link = current.ansiblexLinks.find((candidate) => candidate.id === linkId);
      if (!link) return current;
      const upgradesBySystem = { ...current.upgradesBySystem };
      for (const endpoint of [link.from, link.to]) {
        const key = String(endpoint);
        const upgrades = (upgradesBySystem[key] ?? []).filter(
          (upgrade) => upgrade.typeId !== ADVANCED_LOGISTICS_NETWORK_TYPE_ID,
        );
        if (upgrades.length > 0) upgradesBySystem[key] = upgrades;
        else delete upgradesBySystem[key];
      }
      return {
        upgradesBySystem,
        ansiblexLinks: current.ansiblexLinks.filter((candidate) => candidate.id !== linkId),
      };
    });
    setSelectedLinkId(null);
  }, []);

  const removeUpgrade = useCallback((systemId: number, typeId: number) => {
    if (typeId === ADVANCED_LOGISTICS_NETWORK_TYPE_ID) {
      const link = plan.ansiblexLinks.find(
        (candidate) => candidate.from === systemId || candidate.to === systemId,
      );
      if (link) {
        setPendingConfirmation({ kind: 'remove-link', linkId: link.id });
        return;
      }
    }
    setPlan((current) => {
      const key = String(systemId);
      const upgrades = (current.upgradesBySystem[key] ?? [])
        .filter((upgrade) => upgrade.typeId !== typeId);
      const upgradesBySystem = { ...current.upgradesBySystem };
      if (upgrades.length > 0) upgradesBySystem[key] = upgrades;
      else delete upgradesBySystem[key];
      return { ...current, upgradesBySystem };
    });
  }, [plan.ansiblexLinks]);

  const selectedSystem = selectedPlanSystemId == null
    ? null
    : graph?.systems[String(selectedPlanSystemId)] ?? null;
  const selectedSystemUpgrades = selectedPlanSystemId == null
    ? []
    : plan.upgradesBySystem[String(selectedPlanSystemId)] ?? [];
  const selectedSystemSummary = selectedSystem
    ? calculateSystemResources(selectedSystem, selectedSystemUpgrades, definitionsById)
    : null;
  const selectedLink = selectedLinkId == null
    ? null
    : plan.ansiblexLinks.find((link) => link.id === selectedLinkId) ?? null;
  const capitalSystemName = capitalSystemId == null
    ? null
    : graph?.namesById?.[String(capitalSystemId)] ?? String(capitalSystemId);

  const handleConfirm = useCallback(() => {
    if (!pendingConfirmation) return;
    if (pendingConfirmation.kind === 'territory') {
      const removed = new Set(pendingConfirmation.removedIds);
      const nextSystemIds = new Set(pendingConfirmation.nextIds);
      setPlan((current) => removeSystemsFromPlan(current, removed));
      setSelectedSystemIds(nextSystemIds);
      setCapitalSystemId((current) => (
        current != null && !nextSystemIds.has(current) ? null : current
      ));
      setSelectedPlanSystemId((current) => (
        current != null && removed.has(current) ? null : current
      ));
      setSelectedLinkId(null);
    } else if (pendingConfirmation.kind === 'replace') {
      addUpgrade(
        pendingConfirmation.systemId,
        pendingConfirmation.nextTypeId,
        pendingConfirmation.currentTypeId,
      );
    } else if (pendingConfirmation.kind === 'remove-link') {
      removeLink(pendingConfirmation.linkId);
    } else {
      setPlan(emptySovereigntyPlan());
      setSelectedPlanSystemId(null);
      setSelectedLinkId(null);
      setPendingAnsiblexFrom(null);
    }
    setPendingConfirmation(null);
  }, [addUpgrade, pendingConfirmation, removeLink]);

  const confirmationCopy = useMemo(() => {
    if (!pendingConfirmation) return null;
    if (pendingConfirmation.kind === 'territory') {
      return {
        title: 'Remove planned assets?',
        message: `This removes upgrades and links from ${pendingConfirmation.removedIds.length.toLocaleString()} system(s) leaving your territory.`,
        confirmLabel: 'Remove systems',
      };
    }
    if (pendingConfirmation.kind === 'replace') {
      return {
        title: 'Replace conflicting upgrade?',
        message: `${definitionsById.get(pendingConfirmation.currentTypeId)?.name ?? 'The existing upgrade'} will be replaced by ${definitionsById.get(pendingConfirmation.nextTypeId)?.name ?? 'the selected upgrade'}.`,
        confirmLabel: 'Replace',
      };
    }
    if (pendingConfirmation.kind === 'remove-link') {
      return {
        title: 'Remove Ansiblex link?',
        message: 'The link and Advanced Logistics Network upgrades at both endpoints will be removed.',
        confirmLabel: 'Remove link',
      };
    }
    return {
      title: 'Clear sovereignty plan?',
      message: 'All planned upgrades and Ansiblex links will be removed. Your selected territory will remain.',
      confirmLabel: 'Clear plan',
    };
  }, [definitionsById, pendingConfirmation]);

  return (
    <>
      <div className="grid min-h-[540px] flex-1 gap-4 md:grid-cols-[18rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        <aside
          className="flex min-h-32 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white/50 p-4 dark:border-gray-700 dark:bg-black/20 md:min-h-0"
          aria-label="Sovereignty planner toolbar"
        >
          {territoryEditing ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Territory
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Select the space you want to manage
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTerritoryEditing(false);
                    setSearchQuery('');
                  }}
                  className="shrink-0 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
                >
                  Done
                </button>
              </div>
              <div
                className="grid grid-cols-2 rounded-md border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900"
                role="group"
                aria-label="Territory editing tool"
              >
                <button
                  type="button"
                  aria-pressed={territoryEditTool === 'territory'}
                  onClick={() => setTerritoryEditTool('territory')}
                  className={`rounded px-2 py-1.5 text-xs font-medium transition ${
                    territoryEditTool === 'territory'
                      ? 'bg-white text-purple-700 shadow-sm dark:bg-slate-700 dark:text-purple-300'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Territory
                </button>
                <button
                  type="button"
                  aria-pressed={territoryEditTool === 'capital'}
                  onClick={() => {
                    setTerritoryEditTool('capital');
                    setSearchQuery('');
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition ${
                    territoryEditTool === 'capital'
                      ? 'bg-white text-purple-700 shadow-sm dark:bg-slate-700 dark:text-purple-300'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon name="star" size={13} />
                  Capital
                </button>
              </div>

              {territoryEditTool === 'territory' ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Add territory
                  </label>
                  <AutocompleteInput
                    compact
                    graph={graph}
                    value={searchQuery}
                    onChange={setSearchQuery}
                    onSelect={handleAutocompleteSelect}
                    items={selectionIndex.items}
                    placeholder="System, region, alliance…"
                  />
                  {holderStatus === 'loading' && (
                    <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      Loading live sovereignty holders…
                    </p>
                  )}
                  {holderStatus === 'error' && (
                    <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                      Live alliance and corporation search is unavailable.
                    </p>
                  )}
                </div>
              ) : (
                <div className="border-y border-slate-200 py-3 dark:border-slate-700">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Capital system
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <Icon name={capitalSystemId == null ? 'star' : 'star-fill'} size={16} />
                      <span className="truncate">{capitalSystemName ?? 'Not selected'}</span>
                    </div>
                    {capitalSystemId != null && (
                      <button
                        type="button"
                        onClick={() => setCapitalSystemId(null)}
                        className="shrink-0 text-xs font-medium text-purple-700 hover:underline dark:text-purple-300"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="border-y border-slate-200 py-3 dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400">Selected territory</div>
                <div className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {selectedSystemIds.size.toLocaleString()} systems
                </div>
              </div>
              <div className="text-xs leading-4 text-slate-500 dark:text-slate-400">
                {territoryEditTool === 'territory'
                  ? 'Hold Alt or Option and drag on the map to lasso systems.'
                  : capitalSystemId == null
                    ? 'Choose a system already inside your territory.'
                    : 'Choose another system to move the capital, or click the current capital to clear it.'}
              </div>
              {territoryEditTool === 'territory' && (
                <button
                  type="button"
                  onClick={() => requestSelectionChange(new Set())}
                  disabled={selectedSystemIds.size === 0}
                  className="mt-auto rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  Clear all territory
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setTerritoryEditTool('territory');
                  setTerritoryEditing(true);
                  setActiveUpgradeTypeId(null);
                  setPendingAnsiblexFrom(null);
                }}
                className="flex w-full items-center justify-between gap-3 border-b border-slate-200 pb-3 text-left transition hover:text-purple-700 dark:border-slate-700 dark:hover:text-purple-300"
              >
                <span>
                  <span className="block text-sm font-medium">Territory</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {selectedSystemIds.size.toLocaleString()} systems
                  </span>
                </span>
                <span className="text-xs font-medium text-purple-700 dark:text-purple-400">Edit</span>
              </button>

              <div className="border-b border-slate-200 pb-3 dark:border-slate-700">
                <div className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  Place upgrades
                </div>
                {definitionStatus === 'ready' ? (
                  <SovereigntyUpgradePicker
                    definitions={definitions}
                    selectedTypeId={activeUpgradeTypeId}
                    onSelect={(typeId) => {
                      setActiveUpgradeTypeId(typeId);
                      setPendingAnsiblexFrom(null);
                      setSelectedPlanSystemId(null);
                      setSelectedLinkId(null);
                      setNotice(null);
                    }}
                  />
                ) : (
                  <div className="py-2 text-xs text-slate-500 dark:text-slate-400">
                    {definitionStatus === 'error'
                      ? 'Upgrade catalogue unavailable.'
                      : 'Loading upgrade catalogue…'}
                  </div>
                )}
              </div>

              {activeDefinition && (
                <div className="border-l-2 border-purple-500 py-1 pl-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <img
                        src={getSovereigntyUpgradeIconUrl(activeDefinition.typeId)}
                        alt=""
                        aria-hidden="true"
                        className="h-8 w-8 shrink-0 rounded object-contain"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-purple-900 dark:text-purple-200">
                          {activeDefinition.name}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-4 text-purple-700 dark:text-purple-300">
                          {placementMode === 'ansiblex'
                            ? pendingAnsiblexFrom == null
                              ? 'Choose the first endpoint.'
                              : `From ${graph?.namesById?.[String(pendingAnsiblexFrom)] ?? pendingAnsiblexFrom}; choose the second endpoint.`
                            : 'Click systems to place repeatedly.'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveUpgradeTypeId(null);
                        setPendingAnsiblexFrom(null);
                      }}
                      className="text-[11px] font-medium text-purple-700 hover:underline dark:text-purple-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {notice && (
                <div className="border-l-2 border-amber-500 py-1 pl-3 text-xs leading-4 text-amber-700 dark:text-amber-300">
                  {notice}
                </div>
              )}

              {(planSummary.upgradeCount > 0 || planSummary.ansiblexCount > 0) && (
                <button
                  type="button"
                  onClick={() => setPendingConfirmation({ kind: 'clear-plan' })}
                  className="mt-auto w-full rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  Clear plan
                </button>
              )}
            </>
          )}
        </aside>

        <SovereigntyPlannerMap
          graph={graph}
          selectedSystemIds={selectedSystemIds}
          holdingAllianceIdsBySystemId={holdingAllianceIdsBySystemId}
          onToggleSystem={toggleTerritorySystem}
          territoryEditing={territoryEditing}
          territoryEditTool={territoryEditTool}
          capitalSystemId={capitalSystemId}
          onCapitalSystemClick={selectCapitalSystem}
          onLassoSelection={handleLassoSelection}
          fitSelectionRequest={fitSelectionRequest}
          placementMode={placementMode}
          pendingAnsiblexFrom={pendingAnsiblexFrom}
          plannedLinks={plan.ansiblexLinks}
          plannedUpgradesBySystem={plan.upgradesBySystem}
          upgradeDefinitionsById={definitionsById}
          planSummary={planSummary}
          selectedLinkId={selectedLinkId}
          systemPlanSummaries={planSummary.systems}
          placementBlockedReasons={placementBlockedReasons}
          onPlanSystemClick={handlePlanSystemClick}
          onSelectLink={(linkId) => {
            setSelectedLinkId(linkId);
            setSelectedPlanSystemId(null);
            setInspectorTab('system');
          }}
        />

        <aside
          className="flex min-h-32 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-lg border border-gray-200 bg-white/50 p-4 dark:border-gray-700 dark:bg-black/20 md:col-span-2 lg:col-span-1 lg:min-h-0"
          aria-label="Sovereignty planner inspector"
        >
          <SegmentedSlider
            options={INSPECTOR_TABS}
            value={inspectorTab}
            onChange={(value) => setInspectorTab(value as InspectorTab)}
            targetWidth={256}
            height={34}
            labelClassName="!text-xs"
            getColorForValue={() => 'bg-purple-600'}
          />

          {inspectorTab === 'system' ? (
            selectedSystem && selectedSystemSummary ? (
              <div className="mt-4 min-h-0">
                <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                  <span className="min-w-0 truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                    {graph?.namesById?.[String(selectedSystem.systemId)] ?? selectedSystem.systemId}
                  </span>
                  <span
                    className="shrink-0 text-sm font-bold"
                    style={{
                      color: getSovereigntySecurityColor(selectedSystem.security ?? 0),
                    }}
                  >
                    {(selectedSystem.security ?? 0).toFixed(1)}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">·</span>
                  <span className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">
                    {graph?.regionsById?.[String(selectedSystem.regionId)] ?? selectedSystem.regionId}
                  </span>
                </div>

                <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Resources
                  </div>
                  <div className="space-y-1">
                    <ResourceLine
                      label="Power"
                      value={`${formatNumber(selectedSystemSummary.allocatedPower)} / ${formatNumber(selectedSystemSummary.totalPower)}`}
                      tone={selectedSystemSummary.remainingPower < 0 ? 'warn' : 'normal'}
                    />
                    <ResourceLine
                      label="Power remaining"
                      value={formatNumber(selectedSystemSummary.remainingPower)}
                      tone={selectedSystemSummary.remainingPower < 0 ? 'warn' : 'good'}
                    />
                    <ResourceLine
                      label="Workforce"
                      value={`${formatNumber(selectedSystemSummary.allocatedWorkforce)} / ${formatNumber(selectedSystemSummary.totalWorkforce)}`}
                      tone={selectedSystemSummary.remainingWorkforce < 0 ? 'warn' : 'normal'}
                    />
                    <ResourceLine
                      label="Import required"
                      value={formatNumber(selectedSystemSummary.workforceImportRequired)}
                      tone={selectedSystemSummary.workforceImportRequired > 0 ? 'warn' : 'normal'}
                    />
                    <ResourceLine
                      label="Magmatic Gas"
                      value={formatNumber(selectedSystem.magmaticGas ?? 0)}
                    />
                    <ResourceLine
                      label="Superionic Ice"
                      value={formatNumber(selectedSystem.superionicIce ?? 0)}
                    />
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Planned upgrades
                  </div>
                  <ul className="space-y-2">
                    {selectedSystemUpgrades.map((upgrade) => (
                      <li key={upgrade.typeId} className="flex items-start justify-between gap-2 text-xs">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <img
                            src={getSovereigntyUpgradeIconUrl(upgrade.typeId)}
                            alt=""
                            aria-hidden="true"
                            className="h-6 w-6 shrink-0 object-contain"
                          />
                          <span>{definitionsById.get(upgrade.typeId)?.name ?? upgrade.typeId}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeUpgrade(selectedSystem.systemId, upgrade.typeId)}
                          className="shrink-0 text-red-600 hover:underline dark:text-red-400"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {selectedSystemUpgrades.length === 0 && (
                      <li className="text-xs text-slate-500 dark:text-slate-400">
                        No upgrades planned.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            ) : selectedLink ? (
              <div className="mt-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold">Ansiblex link</div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {graph?.namesById?.[String(selectedLink.from)] ?? selectedLink.from}
                      {' ⇄ '}
                      {graph?.namesById?.[String(selectedLink.to)] ?? selectedLink.to}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {graph
                        ? `${getAnsiblexDistanceLy(graph, selectedLink.from, selectedLink.to).toFixed(1)} ly`
                        : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedLinkId(null)}
                    className="shrink-0 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Close
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingConfirmation({
                    kind: 'remove-link',
                    linkId: selectedLink.id,
                  })}
                  className="mt-4 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Remove link
                </button>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-3 py-12 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
                Select a system or Ansiblex link on the map to inspect it.
              </div>
            )
          ) : inspectorTab === 'workforce' ? (
            <div className="flex flex-1 flex-col items-center justify-center px-3 py-12 text-center">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Workforce transfers
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                Workforce transfer planning will appear here.
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-3 py-12 text-center">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Routing
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                Infrastructure and transfer routing tools will appear here.
              </div>
            </div>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmationCopy != null}
        title={confirmationCopy?.title ?? ''}
        message={confirmationCopy?.message ?? ''}
        confirmLabel={confirmationCopy?.confirmLabel}
        tone="danger"
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={handleConfirm}
      />
    </>
  );
}
