import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { TOOL_LABELS, type ToolKey } from '../lib/eveAuth';
import { useAuth } from './AuthProvider';

export function RequireAccess({ tool, children }: { tool: ToolKey; children: ReactNode }) {
  const { session, status, login, logout, hasAccess } = useAuth();
  const location = useLocation();
  const label = TOOL_LABELS[tool];
  const base = (import.meta as any).env?.BASE_URL || '/';
  const [corpName, setCorpName] = useState<string | null>(null);
  const [allianceName, setAllianceName] = useState<string | null>(null);
  const isPublicScanner = tool === 'scanner' && (() => {
    const params = new URLSearchParams(location.search);
    const flag = params.get('public');
    return flag === '1' || flag === 'true';
  })();

  useEffect(() => {
    setCorpName(null);
    setAllianceName(null);
    if (!session) return;
    let cancelled = false;
    const loadNames = async () => {
      if (session.corporationId) {
        try {
          const resp = await fetch(`https://esi.evetech.net/latest/corporations/${session.corporationId}/?datasource=tranquility`);
          if (resp.ok) {
            const data = await resp.json();
            if (!cancelled && data?.name) setCorpName(String(data.name));
          }
        } catch {}
      }
      if (session.allianceId) {
        try {
          const resp = await fetch(`https://esi.evetech.net/latest/alliances/${session.allianceId}/?datasource=tranquility`);
          if (resp.ok) {
            const data = await resp.json();
            if (!cancelled && data?.name) setAllianceName(String(data.name));
          }
        } catch {}
      }
    };
    loadNames();
    return () => { cancelled = true; };
  }, [session?.corporationId, session?.allianceId, session]);

  if (isPublicScanner) {
    return <>{children}</>;
  }

  if (status === 'loading') {
    return (
      <section className="max-w-xl mx-auto">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold mb-2">Signing you in...</h1>
          <p className="text-slate-600 dark:text-slate-300">Completing EVE Online authentication.</p>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="max-w-xl mx-auto">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold mb-2">Login required</h1>
          <p className="text-slate-600 dark:text-slate-300">Sign in with an approved EVE Online account to access {label}.</p>
          <button
            onClick={login}
            className="mt-4 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            aria-label="Log in with EVE Online"
          >
            <img
              src={`${base}eve-sso-login-white-large.png`}
              alt="Log in with EVE Online"
              className="block dark:hidden h-10 w-auto"
            />
            <img
              src={`${base}eve-sso-login-black-large.png`}
              alt="Log in with EVE Online"
              className="hidden dark:block h-10 w-auto"
            />
          </button>
        </div>
      </section>
    );
  }

  if (!hasAccess(tool)) {
    const characterLine = `Character: ${session.characterName} (${session.characterId})`;
    const corpLine = session.corporationId
      ? `Corporation: ${corpName ? `${corpName} (${session.corporationId})` : session.corporationId}`
      : 'Corporation: N/A';
    const allianceLine = session.allianceId
      ? `Alliance: ${allianceName ? `${allianceName} (${session.allianceId})` : session.allianceId}`
      : 'Alliance: None';

    return (
      <section className="max-w-xl mx-auto">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm dark:border-amber-800/60 dark:bg-amber-950/30">
          <h1 className="text-2xl font-semibold mb-2">Access restricted</h1>
          <p className="text-amber-900 dark:text-amber-100">Your account is not on the {label} whitelist.</p>
          <div className="mt-3 text-sm text-amber-900 dark:text-amber-100">
            <p>{characterLine}</p>
            <p>{corpLine}</p>
            <p>{allianceLine}</p>
          </div>
          <p className="mt-3 text-sm text-amber-900 dark:text-amber-100">
            For access, contact theeveeye on Discord or send EVE Mail to SomeKiwi in game.
          </p>
          <button
            onClick={logout}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-amber-900 text-amber-50 px-3 py-1.5 text-sm font-medium hover:bg-amber-800"
          >
            Log out
          </button>
        </div>
      </section>
    );
  }

  return <>{children}</>;
}
