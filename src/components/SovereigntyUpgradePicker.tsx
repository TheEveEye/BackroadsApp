import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getSovereigntyUpgradeIconUrl,
  getSovereigntyUpgradeResourceLines,
} from '../lib/sovereigntyPlan';
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

type UpgradeInfoPopover = {
  typeId: number;
  left: number;
  top: number;
};

const INFO_POPOVER_WIDTH = 320;
const INFO_POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 8;

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
  const [infoPopover, setInfoPopover] = useState<UpgradeInfoPopover | null>(null);
  const infoPopoverRef = useRef<HTMLDivElement | null>(null);
  const hideInfoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idPrefix = useId();
  const tree = useMemo(() => buildPickerTree(definitions), [definitions]);
  const unavailable = disabled || tree.length === 0;
  const infoDefinition = infoPopover
    ? definitions.find((definition) => definition.typeId === infoPopover.typeId) ?? null
    : null;
  const infoResourceRows = infoDefinition
    ? getSovereigntyUpgradeResourceLines(infoDefinition)
    : [];

  const keepUpgradeInfoOpen = () => {
    if (hideInfoTimeoutRef.current != null) clearTimeout(hideInfoTimeoutRef.current);
    hideInfoTimeoutRef.current = null;
  };
  const hideUpgradeInfo = () => {
    keepUpgradeInfoOpen();
    hideInfoTimeoutRef.current = setTimeout(() => setInfoPopover(null), 150);
  };

  useEffect(() => () => {
    if (hideInfoTimeoutRef.current != null) clearTimeout(hideInfoTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!infoPopover) return;
    const dismiss = () => setInfoPopover(null);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && infoPopoverRef.current?.contains(event.target)) return;
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [infoPopover]);

  useLayoutEffect(() => {
    if (!infoPopover || !infoPopoverRef.current) return;
    const rect = infoPopoverRef.current.getBoundingClientRect();
    const left = Math.max(VIEWPORT_MARGIN, Math.min(infoPopover.left, window.innerWidth - rect.width - VIEWPORT_MARGIN));
    const top = Math.max(VIEWPORT_MARGIN, Math.min(infoPopover.top, window.innerHeight - rect.height - VIEWPORT_MARGIN));
    if (left !== infoPopover.left || top !== infoPopover.top) {
      setInfoPopover({ ...infoPopover, left, top });
    }
  }, [infoPopover]);

  const toggleNode = (nodeId: string) => {
    setInfoPopover(null);
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

  const showUpgradeInfo = (element: HTMLElement, typeId: number) => {
    keepUpgradeInfoOpen();
    const rect = element.getBoundingClientRect();
    const fitsToRight = rect.right
      + INFO_POPOVER_GAP
      + INFO_POPOVER_WIDTH
      <= window.innerWidth - VIEWPORT_MARGIN;
    const left = fitsToRight
      ? rect.right + INFO_POPOVER_GAP
      : Math.max(
        VIEWPORT_MARGIN,
        rect.left - INFO_POPOVER_WIDTH - INFO_POPOVER_GAP,
      );
    const top = Math.max(VIEWPORT_MARGIN, rect.top);
    setInfoPopover({ typeId, left, top });
  };

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
              <div className={`flex w-full items-center rounded transition-colors ${
                  selected
                    ? 'bg-purple-100 font-medium text-purple-900 dark:bg-purple-950/60 dark:text-purple-200'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => onSelect(node.definition!.typeId)}
                  aria-label={node.ariaLabel}
                  aria-pressed={selected}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500 disabled:opacity-50"
                >
                  <img
                    src={getSovereigntyUpgradeIconUrl(node.definition.typeId)}
                    alt=""
                    aria-hidden="true"
                    className="h-6 w-6 shrink-0 object-contain"
                  />
                  <span className="min-w-0">{node.label}</span>
                </button>
                <button
                  type="button"
                  disabled={unavailable}
                  aria-label={`Information about ${node.definition.name}`}
                  aria-expanded={infoPopover?.typeId === node.definition.typeId}
                  aria-describedby={infoPopover?.typeId === node.definition.typeId
                    ? contentId(`info:${node.definition.typeId}`)
                    : undefined}
                  onMouseEnter={(event) => (
                    showUpgradeInfo(event.currentTarget, node.definition!.typeId)
                  )}
                  onMouseLeave={hideUpgradeInfo}
                  onFocus={(event) => (
                    showUpgradeInfo(event.currentTarget, node.definition!.typeId)
                  )}
                  onBlur={hideUpgradeInfo}
                  onClick={(event) => (
                    showUpgradeInfo(event.currentTarget, node.definition!.typeId)
                  )}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    setInfoPopover(null);
                    event.currentTarget.blur();
                  }}
                  className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 outline-none hover:bg-white/70 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none">
                    i
                  </span>
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className={className}>
        {tree.length > 0 && renderNodes(tree, 0)}
      </div>
      {infoPopover && infoDefinition && typeof document !== 'undefined' && createPortal(
        <div
          ref={infoPopoverRef}
          id={contentId(`info:${infoDefinition.typeId}`)}
          role="tooltip"
          onMouseEnter={keepUpgradeInfoOpen}
          onMouseLeave={hideUpgradeInfo}
          className="fixed z-[100] max-h-[calc(100dvh-16px)] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-slate-800 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          style={{ left: infoPopover.left, top: infoPopover.top }}
        >
          <div className="flex items-center gap-3">
            <img
              src={getSovereigntyUpgradeIconUrl(infoDefinition.typeId)}
              alt=""
              aria-hidden="true"
              className="h-9 w-9 shrink-0 object-contain"
            />
            <div className="min-w-0 text-sm font-semibold">
              {infoDefinition.name}
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
            {infoDefinition.description
              || 'No description is available for this upgrade.'}
          </p>
          <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Resources
            </div>
            {infoResourceRows.length > 0 ? (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-xs">
                {infoResourceRows.map((row) => (
                  <div key={row.label} className="contents">
                    <span className="min-w-0 text-slate-500 dark:text-slate-400">
                      {row.label}
                    </span>
                    <span className={`text-right font-medium tabular-nums ${
                      row.production
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-800 dark:text-slate-200'
                    }`}>
                      {row.production ? '+' : ''}
                      {Math.round(row.amount).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                No power, workforce, or fuel costs.
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
