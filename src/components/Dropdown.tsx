import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Icon } from './Icon';

export type DropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type DropdownProps = {
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  label?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
};

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  label,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  align = 'left',
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !containerRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus();
  }, [open, selectedIndex]);

  const focusOption = (startIndex: number, direction: 1 | -1) => {
    if (options.length === 0) return;
    let index = startIndex;
    for (let offset = 0; offset < options.length; offset += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index]?.disabled) {
        optionRefs.current[index]?.focus();
        return;
      }
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focusedIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(focusedIndex, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(focusedIndex, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(-1, 1);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(0, -1);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex items-center justify-between gap-1 rounded border border-gray-300 bg-white/80 px-2 py-1 text-xs font-medium text-slate-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-slate-100 dark:hover:bg-gray-800 ${buttonClassName}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {label && (
            <span className="font-normal text-slate-600 dark:text-slate-300">
              {label}
            </span>
          )}
          <span className="grid">
            <span className="col-start-1 row-start-1">
              {selectedOption?.label ?? value}
            </span>
            {options.map((option) => (
              <span
                key={option.value}
                aria-hidden="true"
                className="invisible col-start-1 row-start-1"
              >
                {option.label}
              </span>
            ))}
          </span>
        </span>
        <Icon name="chevron-down" size={11} />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute top-full z-30 mt-1 min-w-full overflow-hidden rounded-md border border-gray-200 bg-white text-xs text-slate-700 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-slate-300 ${align === 'right' ? 'right-0' : 'left-0'} ${menuClassName}`}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                className={`block w-full whitespace-nowrap px-2.5 py-1.5 text-left disabled:opacity-50 ${
                  selected
                    ? 'bg-gray-100 font-medium text-slate-900 dark:bg-gray-800 dark:text-slate-100'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
