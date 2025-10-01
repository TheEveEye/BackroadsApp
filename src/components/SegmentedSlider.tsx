import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type Option = { label: string; value: string };

export type SegmentedSliderProps = {
  options: Option[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  height?: number; // px
  radius?: number; // px
  disabled?: boolean;
  // Returns a className to color the moving pill (e.g., 'bg-blue-600').
  // If a raw CSS color value is returned (e.g., '#fff' or 'rgb(...)'), it will be applied via inline style.
  getColorForValue?: (value: string) => string | undefined;
};

// A horizontal, single-select segmented slider with click and drag.
// - Uses Pointer Events for unified mouse/touch dragging
// - Drag updates the pill position live; on release, snaps to nearest option and fires onChange
// - Click fires immediately
export function SegmentedSlider({
  options,
  value,
  defaultValue,
  onChange,
  className,
  style,
  height = 42,
  radius = 6,
  disabled = false,
  getColorForValue,
}: SegmentedSliderProps) {
  const isControlled = value != null;
  const [internal, setInternal] = useState<string | undefined>(() => value ?? defaultValue);
  const selectedValue = (isControlled ? value : internal);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const count = options.length || 1;
  const [measuredSegW, setMeasuredSegW] = useState<number>(0);
  const [measuredPadX, setMeasuredPadX] = useState<number>(0);
  const fallbackSegW = 56; // sensible default
  const segmentWidth = measuredSegW > 0 ? measuredSegW : fallbackSegW;
  const padX = measuredPadX > 0 ? measuredPadX : 12; // px-3 ≈ 12px default
  const overlap = padX / 2; // overlap by half of one padding
  const stepWidth = Math.max(1, segmentWidth - overlap); // distance between segment centers with half-padding overlap
  const containerWidth = segmentWidth + Math.max(0, count - 1) * stepWidth;

  const selectedIndexRaw = options.findIndex(o => o.value === selectedValue);
  const hasSelection = selectedIndexRaw >= 0;
  const selectedIndex = Math.max(0, selectedIndexRaw);

  // Drag state
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null); // left offset of pill while dragging

  // Measure per-option width based on content; all segments share max width
  useLayoutEffect(() => {
    const doMeasure = () => {
      const el = measureRef.current;
      if (!el) return;
      let maxW = 0;
      const children = Array.from(el.children) as HTMLElement[];
      for (const c of children) {
        const w = c.offsetWidth;
        if (w > maxW) maxW = w;
        if (!measuredPadX) {
          const cs = window.getComputedStyle(c);
          const pl = parseFloat(cs.paddingLeft || '0');
          // buttons use symmetric padding (px-3); capture once
          if (pl > 0) setMeasuredPadX(Math.round(pl));
        }
      }
      if (maxW > 0) setMeasuredSegW(Math.ceil(maxW + 4));
    };
    doMeasure();
    window.addEventListener('resize', doMeasure);
    return () => window.removeEventListener('resize', doMeasure);
  }, [options.map(o => o.label + '|' + o.value).join('|')]);

  // Compute pill left position in px for the current selection (non-dragging)
  const selectedLeft = useMemo(() => selectedIndex * stepWidth, [selectedIndex, stepWidth]);

  // Helper to clamp x to container bounds
  const clampX = useCallback((x: number) => {
    const min = 0;
    const max = Math.max(0, containerWidth - segmentWidth);
    if (x < min) return min;
    if (x > max) return max;
    return x;
  }, [containerWidth, segmentWidth]);

  // Convert x offset to nearest index
  const xToIndex = useCallback((x: number) => {
    const idx = Math.round(x / Math.max(1, stepWidth));
    return Math.min(count - 1, Math.max(0, idx));
  }, [count, stepWidth]);

  // Start dragging on pointer down
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    // Prefer hit-testing against current pill bounds when selected
    const pillL = selectedIndex * stepWidth;
    const onPill = hasSelection && relX >= pillL && relX <= (pillL + segmentWidth);
    // Determine which segment was pressed (for fallback quick-select behavior)
    const pressedIdx = Math.min(count - 1, Math.max(0, Math.floor(relX / Math.max(1, stepWidth))));
    if (onPill || (hasSelection && pressedIdx === selectedIndex)) {
      // Start drag only if pressing within the current pill
      try { el.setPointerCapture(e.pointerId); } catch {}
      const x = clampX(relX - segmentWidth / 2);
      setDragging(true);
      setDragX(x);
    } else {
      // Do not initiate drag here; clicks on buttons will handle selection + animation
    }
  }, [clampX, count, hasSelection, segmentWidth, selectedIndex, stepWidth, disabled]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Keep pill centered under cursor while dragging
    const x = clampX(e.clientX - rect.left - segmentWidth / 2);
    setDragX(x);
  }, [dragging, clampX, segmentWidth]);

  const commitIndex = useCallback((idx: number) => {
    const next = options[idx]?.value;
    if (!next) return;
    if (isControlled) {
      if (next !== value) onChange?.(next);
    } else {
      setInternal(next);
      if (next !== selectedValue) onChange?.(next);
    }
  }, [isControlled, onChange, options, selectedValue, value]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    const idx = xToIndex(clampX(dragX ?? 0));
    setDragging(false);
    setDragX(null);
    commitIndex(idx);
  }, [clampX, commitIndex, dragX, dragging, xToIndex]);

  const onClickOption = useCallback((idx: number) => {
    if (disabled) return;
    commitIndex(idx);
  }, [commitIndex, disabled]);

  // Determine pill visual styles
  const pillLeft = dragging ? clampX(dragX ?? 0) : selectedLeft;
  const visualIndex = dragging ? xToIndex(pillLeft) : selectedIndex;
  const visualValue = options[visualIndex]?.value;
  const colorToken = getColorForValue ? (visualValue != null ? getColorForValue(visualValue) : undefined) : undefined;
  const isRawColor = !!colorToken && (/^#/.test(colorToken) || /^(rgb|hsl)a?\(/.test(colorToken));

  return (
    <div
      ref={containerRef}
      className={[
        'relative inline-block select-none',
        'border border-gray-200 dark:border-gray-700 rounded-md',
        'bg-white dark:bg-gray-900',
        disabled ? 'opacity-60 pointer-events-none' : 'cursor-pointer',
        className || '',
      ].join(' ')}
      style={{
        ...style,
        height: height != null ? `${height}px` : undefined,
        width: `${containerWidth}px`,
        borderRadius: radius,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Pill */}
      <div
        className={[
          'absolute top-0 left-0 h-full',
          'rounded-md shadow-sm',
          // If colorToken looks like a Tailwind class, apply it; else fallback
          !isRawColor ? (colorToken || 'bg-blue-600') : '',
        ].join(' ')}
        style={{
          width: `${segmentWidth}px`,
          transform: `translateX(${pillLeft}px)`,
          // Inner radius should be concentric with container inner curve (minus 1px border)
          borderRadius: Math.max(0, radius - 1),
          backgroundColor: isRawColor ? colorToken : undefined,
          opacity: dragging ? 1 : (hasSelection ? 1 : 0),
          transition: dragging
            ? 'background-color 200ms ease-in-out'
            : 'transform 200ms ease-in-out, background-color 200ms ease-in-out',
        }}
      />

      {/* Options overlay */}
      <div className="relative z-10 flex items-stretch h-full">
        {options.map((opt, idx) => {
          const isActive = idx === (dragging ? visualIndex : selectedIndex);
          return (
            <button
              key={opt.value}
              type="button"
              className={[
                'inline-flex items-center justify-center',
                'text-base leading-6 font-medium px-3 h-full',
                'rounded-md', // ensures pointer areas match visuals
                (hasSelection && isActive) ? 'text-white' : 'text-slate-700 dark:text-slate-300',
              ].join(' ')}
              onClick={() => onClickOption(idx)}
              style={{ width: `${segmentWidth}px`, marginLeft: idx === 0 ? undefined : `-${overlap}px` }}
            >
              <span className="pointer-events-none">{opt.label}</span>
            </button>
          );
        })}
      </div>

      {/* Hidden measurer for content-based segment width */}
      <div
        ref={measureRef}
        aria-hidden
        className="absolute -z-10 opacity-0 pointer-events-none"
        style={{ visibility: 'hidden', height: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}
      >
        {options.map((opt) => (
          <span key={opt.value} className="inline-flex items-center justify-center text-base leading-6 font-medium px-3">
            {opt.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default SegmentedSlider;
