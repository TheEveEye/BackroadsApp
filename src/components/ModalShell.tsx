import { useEffect, type ReactNode } from 'react';

export function ModalShell({
  open = true,
  onClose,
  children,
  position = 'top',
  panelClassName = '',
  closeOnEscape = true,
  closeOnBackdrop = false,
  labelledBy,
}: {
  open?: boolean;
  onClose?: () => void;
  children: ReactNode;
  position?: 'top' | 'center';
  panelClassName?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open || !onClose || !closeOnEscape) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEscape, onClose, open]);

  if (!open) return null;

  return (
    <div
      className={
        'fixed inset-0 z-50 flex justify-center px-4 pb-4 ' +
        (position === 'center' ? 'items-center pt-4' : 'items-start pt-[10vh] sm:pt-[12vh]')
      }
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        className={'relative ' + panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}
