import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'warn',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'warn' | 'danger' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const toneClasses = tone === 'danger'
    ? { icon: '#b91c1c', btn: 'bg-red-600 hover:bg-red-700 text-white' }
    : tone === 'warn'
    ? { icon: '#b45309', btn: 'bg-amber-600 hover:bg-amber-700 text-white' }
    : { icon: '#1d4ed8', btn: 'bg-blue-600 hover:bg-blue-700 text-white' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        className="relative w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="flex items-start gap-3">
          <Icon name="warn" size={22} color={toneClasses.icon} />
          <div className="min-w-0">
            <h3 id="confirm-title" className="text-lg font-semibold mb-1">{title}</h3>
            <div className="text-sm text-gray-700 dark:text-gray-300">{message}</div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {/* Confirm (Clear): secondary destructive style to match in-page clear buttons */}
          <button
            className="px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          {/* Cancel: primary button */}
          <button
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
