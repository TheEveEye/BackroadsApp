import { useId, useMemo, useState } from 'react';
import { getSovereigntyUpgradeIconUrl } from '../lib/sovereigntyPlan';
import type {
  SovereigntyUpgradeCategory,
  SovereigntyUpgradeDefinition,
} from '../lib/sovereigntyPlan';
import { Icon } from './Icon';

export type SovereigntyUpgradePickerProps = {
  definitions: readonly SovereigntyUpgradeDefinition[];
  selectedTypeId: number | null;
  onSelect: (typeId: number) => void;
  disabled?: boolean;
  className?: string;
};

type UpgradePickerNode = {
  id: string;
  label: string;
  ariaLabel?: string;
  definition?: SovereigntyUpgradeDefinition;
  children?: UpgradePickerNode[];
};

const CATEGORY_ORDER: readonly SovereigntyUpgradeCategory[] = [
  'Strategic',
  'Ratting',
  'Mining',
  'Exploration',
  'Colony Resources',
  'System Effects',
];

const FAMILY_CATEGORIES = new Set<SovereigntyUpgradeCategory>([
  'Ratting',
  'Mining',
  'Colony Resources',
]);

function compareDefinitions(
  left: SovereigntyUpgradeDefinition,
  right: SovereigntyUpgradeDefinition,
) {
  const tierDifference = (left.tier ?? Number.MAX_SAFE_INTEGER)
    - (right.tier ?? Number.MAX_SAFE_INTEGER);
  return tierDifference || left.name.localeCompare(right.name, undefined, { numeric: true });
}

function leafNode(
  definition: SovereigntyUpgradeDefinition,
  showTierLabel: boolean,
): UpgradePickerNode {
  return {
    id: `upgrade:${definition.typeId}`,
    label: showTierLabel && definition.tier != null
      ? `Tier ${definition.tier}`
      : definition.name,
    ariaLabel: definition.name,
    definition,
  };
}

function buildPickerTree(
  definitions: readonly SovereigntyUpgradeDefinition[],
): UpgradePickerNode[] {
  return CATEGORY_ORDER.flatMap((category) => {
    const categoryDefinitions = definitions
      .filter((definition) => definition.category === category)
      .sort(compareDefinitions);
    if (categoryDefinitions.length === 0) return [];

    if (!FAMILY_CATEGORIES.has(category)) {
      const showTierLabel = category === 'Exploration';
      return [{
        id: `category:${category}`,
        label: category,
        children: categoryDefinitions.map((definition) => (
          leafNode(definition, showTierLabel)
        )),
      }];
    }

    const definitionsWithoutFamily: SovereigntyUpgradeDefinition[] = [];
    const definitionsByFamily = new Map<string, SovereigntyUpgradeDefinition[]>();
    for (const definition of categoryDefinitions) {
      if (!definition.family) {
        definitionsWithoutFamily.push(definition);
        continue;
      }
      const familyDefinitions = definitionsByFamily.get(definition.family) ?? [];
      familyDefinitions.push(definition);
      definitionsByFamily.set(definition.family, familyDefinitions);
    }

    const children: UpgradePickerNode[] = definitionsWithoutFamily.map((definition) => (
      leafNode(definition, false)
    ));
    for (const [family, familyDefinitions] of [...definitionsByFamily.entries()]
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))) {
      children.push({
        id: `family:${category}:${family}`,
        label: family,
        children: familyDefinitions
          .sort(compareDefinitions)
          .map((definition) => leafNode(definition, true)),
      });
    }

    return [{
      id: `category:${category}`,
      label: category,
      children,
    }];
  });
}

export function SovereigntyUpgradePicker({
  definitions,
  selectedTypeId,
  onSelect,
  disabled = false,
  className = '',
}: SovereigntyUpgradePickerProps) {
  const [openNodeIds, setOpenNodeIds] = useState<Set<string>>(() => new Set());
  const idPrefix = useId();
  const tree = useMemo(() => buildPickerTree(definitions), [definitions]);
  const unavailable = disabled || tree.length === 0;

  const toggleNode = (nodeId: string) => {
    setOpenNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const contentId = (nodeId: string) => (
    `${idPrefix}-${nodeId}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  );

  const renderNodes = (nodes: readonly UpgradePickerNode[], depth: number) => (
    <ul className={depth === 0
      ? 'divide-y divide-slate-200 dark:divide-slate-700'
      : 'ml-3 border-l border-slate-200 pl-2 dark:border-slate-700'}
    >
      {nodes.map((node) => {
        const hasChildren = Boolean(node.children?.length);
        const expanded = hasChildren && openNodeIds.has(node.id);
        const selected = node.definition?.typeId === selectedTypeId;
        return (
          <li key={node.id} className={depth === 0 ? 'py-1' : ''}>
            {hasChildren ? (
              <>
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => toggleNode(node.id)}
                  aria-expanded={expanded}
                  aria-controls={contentId(node.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded px-1.5 py-2 text-left outline-none transition-colors ${
                    depth === 0
                      ? 'text-xs font-semibold text-slate-800 dark:text-slate-100'
                      : 'text-xs font-medium text-slate-700 dark:text-slate-200'
                  } hover:bg-slate-100 focus-visible:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800`}
                >
                  <span>{node.label}</span>
                  <Icon
                    name="chevron-down"
                    size={11}
                    className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
                  />
                </button>
                {expanded && node.children && (
                  <div id={contentId(node.id)}>
                    {renderNodes(node.children, depth + 1)}
                  </div>
                )}
              </>
            ) : node.definition ? (
              <button
                type="button"
                disabled={unavailable}
                onClick={() => onSelect(node.definition!.typeId)}
                aria-label={node.ariaLabel}
                aria-pressed={selected}
                title={node.definition.description || undefined}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs outline-none transition-colors ${
                  selected
                    ? 'bg-purple-100 font-medium text-purple-900 dark:bg-purple-950/60 dark:text-purple-200'
                    : 'text-slate-600 hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800'
                }`}
              >
                <img
                  src={getSovereigntyUpgradeIconUrl(node.definition.typeId)}
                  alt=""
                  aria-hidden="true"
                  className="h-6 w-6 shrink-0 object-contain"
                />
                <span className="min-w-0">{node.label}</span>
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={className}>
      {tree.length > 0 && renderNodes(tree, 0)}
    </div>
  );
}
