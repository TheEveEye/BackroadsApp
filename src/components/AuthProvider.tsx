import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AUTH_RETURN_KEY, AUTH_STATE_KEY, AUTH_STORAGE_KEY, AUTH_VERIFIER_KEY, getAuthConfig, isAuthBypassed, isWhitelisted, type EveSession, type ToolKey } from '../lib/eveAuth';

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

type TokenPayload = Record<string, unknown>;

const AuthContext = createContext<{
  bypassEnabled: boolean;
  session: EveSession | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  error: string | null;
  login: () => void;
  logout: () => void;
  hasAccess: (tool: ToolKey) => boolean;
  getAccessToken: () => Promise<string | null>;
} | null>(null);

const loadStoredSession = (): EveSession | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const expiresAt = Number(parsed.expiresAt);
    const refreshToken = parsed.refreshToken ? String(parsed.refreshToken) : undefined;
    if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt && !refreshToken) return null;
    const characterId = Number(parsed.characterId);
    const characterName = String(parsed.characterName || '').trim();
    if (!Number.isFinite(characterId) || !characterName) return null;
    return {
      characterId,
      characterName,
      accessToken: parsed.accessToken ? String(parsed.accessToken) : undefined,
      refreshToken,
      corporationId: parsed.corporationId != null ? Number(parsed.corporationId) : null,
      allianceId: parsed.allianceId != null ? Number(parsed.allianceId) : null,
      ownerHash: parsed.ownerHash ? String(parsed.ownerHash) : undefined,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      scopes: parsed.scopes ? String(parsed.scopes) : undefined,
    };
  } catch {
    return null;
  }
};

const persistSession = (session: EveSession) => {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
};

const clearStoredSession = () => {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
};

const clearLoginState = () => {
  try {
    sessionStorage.removeItem(AUTH_STATE_KEY);
    sessionStorage.removeItem(AUTH_VERIFIER_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
};

const base64UrlEncode = (data: ArrayBuffer) => {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const generateVerifier = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
};

const createChallenge = async (verifier: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
};

const createBypassSession = (): EveSession => ({
  characterId: 0,
  characterName: 'Auth Bypass',
});

const getTokenExpiry = (expiresIn: unknown) => {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : undefined;
};

const getStringField = (payload: TokenPayload | null, key: string) => {
  const value = payload?.[key];
  return typeof value === 'string' && value ? value : undefined;
};

const readJsonObject = async (response: Response): Promise<TokenPayload | null> => {
  const data = await response.json().catch(() => null);
  return data && typeof data === 'object' ? data as TokenPayload : null;
};

const getTokenErrorMessage = (payload: TokenPayload | null, fallback: string) => (
  getStringField(payload, 'error_description') || getStringField(payload, 'error') || fallback
);

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const bypassEnabled = useMemo(() => isAuthBypassed(), []);
  const bypassSession = useMemo(() => (bypassEnabled ? createBypassSession() : null), [bypassEnabled]);
  const hasProcessedCallback = useRef(false);
  const [session, setSession] = useState<EveSession | null>(() => (bypassEnabled ? createBypassSession() : loadStoredSession()));
  const [status, setStatus] = useState<'idle' | 'loading' | 'authenticated' | 'error'>(() => (bypassEnabled || session ? 'authenticated' : 'idle'));
  const [error, setError] = useState<string | null>(null);
  const config = useMemo(() => getAuthConfig(), []);
  const sessionRef = useRef<EveSession | null>(session);
  const refreshInFlightRef = useRef<Promise<EveSession | null> | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const setAndPersistSession = useCallback((nextSession: EveSession) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    persistSession(nextSession);
    setStatus('authenticated');
    setError(null);
  }, []);

  const logout = useCallback(() => {
    if (bypassEnabled) {
      sessionRef.current = bypassSession;
      setSession(bypassSession);
      setStatus('authenticated');
      setError(null);
      return;
    }
    sessionRef.current = null;
    setSession(null);
    setStatus('idle');
    setError(null);
    hasProcessedCallback.current = false;
    clearStoredSession();
    clearLoginState();
    try {
      sessionStorage.removeItem(AUTH_RETURN_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }, [bypassEnabled, bypassSession]);

  const refreshSession = useCallback(async () => {
    if (bypassEnabled) return bypassSession;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const currentSession = sessionRef.current;
    if (!currentSession?.refreshToken) return null;
    if (!config.clientId) {
      setError('Missing EVE client id.');
      setStatus('error');
      return null;
    }

    const refreshPromise = (async () => {
      try {
        const body = new URLSearchParams();
        body.set('grant_type', 'refresh_token');
        body.set('refresh_token', currentSession.refreshToken!);
        body.set('client_id', config.clientId);

        const tokenResp = await fetch(config.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });
        const tokenData = await readJsonObject(tokenResp);
        if (!tokenResp.ok) {
          throw new Error(getTokenErrorMessage(tokenData, 'Failed to refresh EVE token.'));
        }

        const accessToken = getStringField(tokenData, 'access_token');
        if (!accessToken) throw new Error('Missing refreshed access token.');

        const nextSession: EveSession = {
          ...currentSession,
          accessToken,
          refreshToken: getStringField(tokenData, 'refresh_token') || currentSession.refreshToken,
          scopes: getStringField(tokenData, 'scope') || currentSession.scopes,
          expiresAt: getTokenExpiry(tokenData?.expires_in),
        };

        setAndPersistSession(nextSession);
        return nextSession;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to refresh EVE session.';
        logout();
        setError(message);
        setStatus('error');
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [bypassEnabled, bypassSession, config.clientId, config.tokenUrl, logout, setAndPersistSession]);

  const getAccessToken = useCallback(async () => {
    if (bypassEnabled) return null;
    const currentSession = sessionRef.current;
    if (!currentSession) return null;
    const expiresAt = Number(currentSession.expiresAt);
    const hasUsableAccessToken = currentSession.accessToken && (!Number.isFinite(expiresAt) || expiresAt - Date.now() > ACCESS_TOKEN_REFRESH_SKEW_MS);
    if (hasUsableAccessToken) return currentSession.accessToken!;
    const refreshedSession = await refreshSession();
    return refreshedSession?.accessToken ?? null;
  }, [bypassEnabled, refreshSession]);

  const login = useCallback(async () => {
    if (bypassEnabled) {
      setSession(bypassSession);
      setStatus('authenticated');
      setError(null);
      return;
    }
    if (!config.clientId) {
      setError('Missing EVE client id.');
      setStatus('error');
      return;
    }
    try {
      hasProcessedCallback.current = false;
      const state = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : generateVerifier();
      const verifier = generateVerifier();
      const challenge = await createChallenge(verifier);
      sessionStorage.setItem(AUTH_STATE_KEY, state);
      sessionStorage.setItem(AUTH_VERIFIER_KEY, verifier);
      sessionStorage.setItem(AUTH_RETURN_KEY, `${location.pathname}${location.search}${location.hash}`);
      const url = new URL(config.authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.clientId);
      if (config.callbackUrl) url.searchParams.set('redirect_uri', config.callbackUrl);
      if (config.scopes) url.searchParams.set('scope', config.scopes);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      window.location.assign(url.toString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start login.');
      setStatus('error');
    }
  }, [bypassEnabled, bypassSession, config, location.hash, location.pathname, location.search]);

  const hasAccess = useCallback((tool: ToolKey) => (bypassEnabled ? true : isWhitelisted(session, tool)), [bypassEnabled, session]);

  useEffect(() => {
    if (!bypassEnabled || !bypassSession) return;
    setSession(bypassSession);
    setStatus('authenticated');
    setError(null);
  }, [bypassEnabled, bypassSession]);

  useEffect(() => {
    if (bypassEnabled) return;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const authError = params.get('error');
    const authErrorDescription = params.get('error_description');
    const isCallbackPath = location.pathname.endsWith('/auth/callback');
    if (!isCallbackPath) return;
    if (authError) {
      setError(authErrorDescription || authError);
      setStatus('error');
      return;
    }
    if (!code) return;
    if (hasProcessedCallback.current) return;
    hasProcessedCallback.current = true;

    const storedState = sessionStorage.getItem(AUTH_STATE_KEY);
    const verifier = sessionStorage.getItem(AUTH_VERIFIER_KEY);
    if (!storedState || storedState !== state || !verifier) {
      setError('Login session expired. Please try again.');
      setStatus('error');
      clearLoginState();
      return;
    }

    const finishLogin = async () => {
      setStatus('loading');
      setError(null);
      try {
        const body = new URLSearchParams();
        body.set('grant_type', 'authorization_code');
        body.set('code', code);
        body.set('client_id', config.clientId);
        body.set('code_verifier', verifier);
        if (config.callbackUrl) body.set('redirect_uri', config.callbackUrl);

        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };

        const tokenResp = await fetch(config.tokenUrl, {
          method: 'POST',
          headers,
          body: body.toString(),
        });
        const tokenData = await readJsonObject(tokenResp);
        if (!tokenResp.ok) {
          throw new Error(getTokenErrorMessage(tokenData, 'Failed to fetch tokens.'));
        }
        const accessToken = getStringField(tokenData, 'access_token');
        if (!accessToken) throw new Error('Missing access token.');
        const refreshToken = getStringField(tokenData, 'refresh_token');

        const verifyResp = await fetch(config.verifyUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const verifyData = await verifyResp.json();
        if (!verifyResp.ok) {
          throw new Error(verifyData?.error || 'Failed to verify login.');
        }

        const characterId = Number(verifyData.CharacterID);
        const characterName = String(verifyData.CharacterName || '').trim();
        if (!Number.isFinite(characterId) || !characterName) throw new Error('Invalid character response.');

        let corporationId: number | null = null;
        let allianceId: number | null = null;
        try {
          const profileResp = await fetch(`https://esi.evetech.net/latest/characters/${characterId}/?datasource=tranquility`);
          if (profileResp.ok) {
            const profileData = await profileResp.json();
            corporationId = Number(profileData.corporation_id) || null;
            allianceId = Number(profileData.alliance_id) || null;
          }
        } catch {
          // Profile data is only needed for whitelist enrichment.
        }

        const nextSession: EveSession = {
          characterId,
          characterName,
          accessToken,
          refreshToken,
          corporationId,
          allianceId,
          ownerHash: verifyData.CharacterOwnerHash ? String(verifyData.CharacterOwnerHash) : undefined,
          scopes: getStringField(tokenData, 'scope') || config.scopes,
          expiresAt: getTokenExpiry(tokenData?.expires_in),
        };

        setAndPersistSession(nextSession);
        clearLoginState();

        const returnTo = sessionStorage.getItem(AUTH_RETURN_KEY) || '/';
        sessionStorage.removeItem(AUTH_RETURN_KEY);
        navigate(returnTo, { replace: true });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Login failed.');
        setStatus('error');
      }
    };

    finishLogin();
  }, [bypassEnabled, config, location.pathname, location.search, navigate, setAndPersistSession]);

  useEffect(() => {
    if (bypassEnabled) return;
    if (!session?.expiresAt) return;
    const refreshIn = Math.max(0, session.expiresAt - Date.now() - ACCESS_TOKEN_REFRESH_SKEW_MS);
    const timer = window.setTimeout(() => {
      if (sessionRef.current?.refreshToken) {
        refreshSession();
      } else if (sessionRef.current?.expiresAt && Date.now() > sessionRef.current.expiresAt) {
        logout();
      }
    }, refreshIn);
    return () => window.clearTimeout(timer);
  }, [bypassEnabled, session?.expiresAt, refreshSession, logout]);

  return (
    <AuthContext.Provider
      value={{
        bypassEnabled,
        session,
        status,
        error,
        login,
        logout,
        hasAccess,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
