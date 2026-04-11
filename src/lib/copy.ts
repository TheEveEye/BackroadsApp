import { useEffect, useRef, useState } from 'react';

export type CopyStatus = 'success' | 'error';

export async function copyTextWithFallback(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function useCopyStatuses() {
  const [copyStatuses, setCopyStatuses] = useState<Record<string, CopyStatus>>({});
  const copyTimersRef = useRef<Record<string, number>>({});

  useEffect(() => () => {
    for (const timer of Object.values(copyTimersRef.current)) {
      window.clearTimeout(timer);
    }
  }, []);

  const setTransientCopyStatus = (target: string, status: CopyStatus, durationMs: number) => {
    const timers = copyTimersRef.current;
    if (timers[target] != null) {
      window.clearTimeout(timers[target]);
    }
    setCopyStatuses((prev) => ({ ...prev, [target]: status }));
    timers[target] = window.setTimeout(() => {
      setCopyStatuses((prev) => {
        const next = { ...prev };
        delete next[target];
        return next;
      });
      delete timers[target];
    }, durationMs);
  };

  const copyText = async (text: string, target: string, durations?: { success?: number; error?: number }) => {
    const ok = await copyTextWithFallback(text);
    setTransientCopyStatus(target, ok ? 'success' : 'error', ok ? (durations?.success ?? 1200) : (durations?.error ?? 1800));
    return ok;
  };

  return { copyStatuses, copyText };
}

export function getCopyButtonClass(status: CopyStatus | null, idleClassName: string) {
  return (
    idleClassName +
    ' ' +
    (status === 'success'
      ? 'border-green-600 bg-green-600 text-white'
      : status === 'error'
        ? 'border-red-600 bg-red-600 text-white'
        : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800')
  );
}

export function getCopyButtonLabel(status: CopyStatus | null, idleLabel = 'Copy') {
  if (status === 'success') return 'Copied';
  if (status === 'error') return 'Copy failed';
  return idleLabel;
}

export function getCopyButtonIconName(status: CopyStatus | null, idleIconName = 'copy') {
  if (status === 'error') return 'warn';
  if (status === 'success') return 'copy';
  return idleIconName;
}

export function getCopyButtonIconColor(status: CopyStatus | null) {
  return status ? 'white' : undefined;
}
