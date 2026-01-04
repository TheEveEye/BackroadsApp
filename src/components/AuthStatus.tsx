import { useAuth } from './AuthProvider';

export function AuthStatus() {
  const { session, status, login, logout } = useAuth();
  const base = (import.meta as any).env?.BASE_URL || '/';
  const portraitUrl = session ? `https://images.evetech.net/characters/${session.characterId}/portrait?size=64` : '';
  const orgLogoUrl = session?.allianceId
    ? `https://images.evetech.net/alliances/${session.allianceId}/logo?size=64`
    : session?.corporationId
      ? `https://images.evetech.net/corporations/${session.corporationId}/logo?size=64`
      : '';

  if (status === 'loading') {
    return (
      <div className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300">
        Signing in...
      </div>
    );
  }

  if (!session) {
    return (
      <button
        onClick={login}
        className="overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
        aria-label="Log in with EVE Online"
      >
        <img
          src={`${base}eve-sso-login-white-small.png`}
          alt="Log in with EVE Online"
          className="block dark:hidden h-7 w-auto"
        />
        <img
          src={`${base}eve-sso-login-black-small.png`}
          alt="Log in with EVE Online"
          className="hidden dark:block h-7 w-auto"
        />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {orgLogoUrl ? (
        <img
          src={orgLogoUrl}
          alt={session.allianceId ? 'Alliance logo' : 'Corporation logo'}
          className="h-6 w-6 rounded-sm"
        />
      ) : null}
      <img
        src={portraitUrl}
        alt={`${session.characterName} portrait`}
        className="h-7 w-7 rounded-full"
      />
      <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
        {session.characterName}
      </div>
      <button
        onClick={logout}
        className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Log out
      </button>
    </div>
  );
}
