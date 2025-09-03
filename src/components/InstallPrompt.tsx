import { useEffect, useState } from 'react';

// Minimal install prompt button for PWA installation
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: any) => {
      // Prevent the mini-infobar on mobile
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleClick = async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      setVisible(false);
      setDeferred(null);
    }
  };

  if (!visible) return null;

  return (
    <button
      onClick={handleClick}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        padding: '10px 14px',
        borderRadius: 8,
        background: '#0f172a',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.2)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        cursor: 'pointer',
        zIndex: 9999,
      }}
    >
      Install App
    </button>
  );
}

