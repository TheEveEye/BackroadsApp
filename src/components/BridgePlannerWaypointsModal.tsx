import type { MutableRefObject } from 'react';
import type { GraphData } from '../lib/data';
import { AutocompleteInput } from './AutocompleteInput';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';

type RouteStopDragState = {
  activeIndex: number;
  targetIndex: number;
  startY: number;
  currentY: number;
  rowTops: number[];
  rowHeights: number[];
};

function releasePointerCapture(element: HTMLElement, pointerId: number) {
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    // Ignore browsers that already released capture for this pointer.
  }
}

export function BridgePlannerWaypointsModal({
  graph,
  routeStops,
  routeStopKeys,
  dragState,
  isDropping,
  rowRefs,
  getRowTransform,
  onUpdateStop,
  onRemoveStop,
  onAddWaypoint,
  onClose,
  onStartDrag,
  onUpdateDrag,
  onFinishDrag,
  onCancelDrag,
}: {
  graph: GraphData | null;
  routeStops: string[];
  routeStopKeys: string[];
  dragState: RouteStopDragState | null;
  isDropping: boolean;
  rowRefs: MutableRefObject<Array<HTMLDivElement | null>>;
  getRowTransform: (index: number) => string | undefined;
  onUpdateStop: (index: number, value: string) => void;
  onRemoveStop: (index: number) => void;
  onAddWaypoint: () => void;
  onClose: () => void;
  onStartDrag: (index: number, clientY: number) => void;
  onUpdateDrag: (clientY: number) => void;
  onFinishDrag: () => void;
  onCancelDrag: () => void;
}) {
  return (
    <ModalShell
      onClose={onClose}
      panelClassName="w-full max-w-[640px] overflow-visible rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-4"
      labelledBy="route-stops-modal-title"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="route-stops-modal-title" className="text-lg font-semibold">Route stops</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Manage the ordered list of systems the planner must route through.
          </p>
        </div>
        <button
          type="button"
          className="w-9 h-9 p-1.5 rounded-md inline-flex items-center justify-center leading-none border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="grid gap-3">
        {routeStops.map((stop, index) => {
          const isStart = index === 0;
          const isDestination = index === routeStops.length - 1;
          const stopLabel = isStart ? 'Start' : isDestination ? 'End' : `Via ${index}`;
          const isDropTarget = dragState?.targetIndex === index && dragState.activeIndex !== index;
          const isDraggedRow = dragState?.activeIndex === index;
          const rowTransform = getRowTransform(index);
          return (
            <div
              key={routeStopKeys[index] ?? `route-stop-${index}`}
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              className={
                "relative flex items-center gap-2 rounded-md border bg-white dark:bg-gray-900 px-2.5 py-2 transition-colors cursor-grab active:cursor-grabbing " +
                (isDropTarget
                  ? "border-amber-400 bg-amber-50/80 dark:bg-amber-900/20"
                  : "border-gray-200 dark:border-gray-700") +
                (isDraggedRow ? " z-20 shadow-md" : "")
              }
              style={{
                transform: rowTransform,
                transition: (isDraggedRow || isDropping)
                  ? 'none'
                  : 'transform 180ms ease, background-color 180ms ease, border-color 180ms ease',
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const target = event.target as HTMLElement;
                if (target.closest('input, button, ul, li')) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                onStartDrag(index, event.clientY);
              }}
              onPointerMove={(event) => {
                if (dragState?.activeIndex !== index) return;
                onUpdateDrag(event.clientY);
              }}
              onPointerUp={(event) => {
                if (dragState?.activeIndex !== index) return;
                releasePointerCapture(event.currentTarget, event.pointerId);
                onFinishDrag();
              }}
              onPointerCancel={(event) => {
                if (dragState?.activeIndex !== index) return;
                releasePointerCapture(event.currentTarget, event.pointerId);
                onCancelDrag();
              }}
            >
              <div className="shrink-0 w-8 h-8 rounded border border-gray-300 dark:border-gray-700 inline-flex items-center justify-center text-slate-500 dark:text-slate-400">
                <Icon name="line-3-horizontal" size={15} />
              </div>
              <div
                className={
                  'shrink-0 w-14 rounded-md px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide ' +
                  (isStart
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : isDestination
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                      : 'bg-slate-200/70 text-slate-700 dark:bg-slate-800 dark:text-slate-300')
                }
              >
                {stopLabel}
              </div>
              <div className="min-w-0 flex-1">
                <AutocompleteInput
                  compact
                  graph={graph}
                  value={stop}
                  onChange={(value) => onUpdateStop(index, value)}
                  placeholder={isStart ? 'e.g. UALX-3' : isDestination ? 'e.g. C-J6MT' : 'Waypoint system'}
                />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  className="w-8 h-8 rounded border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center justify-center"
                  onClick={() => onRemoveStop(index)}
                  aria-label={isStart ? 'Remove start system' : isDestination ? 'Remove destination system' : `Remove waypoint ${index}`}
                  title={isStart ? 'Remove start system' : isDestination ? 'Remove destination system' : `Remove waypoint ${index}`}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-2"
          onClick={onAddWaypoint}
        >
          <Icon name="plus" size={16} />
          <span>Add waypoint</span>
        </button>
        <button
          type="button"
          className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </ModalShell>
  );
}
