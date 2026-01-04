import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AUTH_RETURN_KEY, AUTH_STATE_KEY, AUTH_STORAGE_KEY, AUTH_VERIFIER_KEY, getAuthConfig, isWhitelisted, type EveSession, type ToolKey } from '../lib/eveAuth';

const AuthContext = createContext<{
  session: EveSession | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  error: string | null;
  login: () => void;
  logout: () => void;
  hasAccess: (tool: ToolKey) => boolean;
} | null>(null);

const loadStoredSession = (): EveSession | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const expiresAt = Number(parsed.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) return null;
    const characterId = Number(parsed.characterId);
    const characterName = String(parsed.characterName || '').trim();
    if (!Number.isFinite(characterId) || !characterName) return null;
    return {
      characterId,
      characterName,
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
  } catch {}
};

const clearStoredSession = () => {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
};

const clearLoginState = () => {
  try {
    sessionStorage.removeItem(AUTH_STATE_KEY);
    sessionStorage.removeItem(AUTH_VERIFIER_KEY);
  } catch {}
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const hasProcessedCallback = useRef(false);
  const [session, setSession] = useState<EveSession | null>(() => loadStoredSession());
  const [status, setStatus] = useState<'idle' | 'loading' | 'authenticated' | 'error'>(() => (session ? 'authenticated' : 'idle'));
  const [error, setError] = useState<string | null>(null);
  const config = useMemo(() => getAuthConfig(), []);

  const logout = useCallback(() => {
    setSession(null);
    setStatus('idle');
    setError(null);
    hasProcessedCallback.current = false;
    clearStoredSession();
    clearLoginState();
    try {
      sessionStorage.removeItem(AUTH_RETURN_KEY);
    } catch {}
  }, []);

  const login = useCallback(async () => {
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
    } catch (err: any) {
      setError(err?.message || 'Failed to start login.');
      setStatus('error');
    }
  }, [config, location.hash, location.pathname, location.search]);

  const hasAccess = useCallback((tool: ToolKey) => isWhitelisted(session, tool), [session]);

  useEffect(() => {
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
        if (!config.clientSecret) {
          body.set('client_id', config.clientId);
        }
        body.set('code_verifier', verifier);
        if (config.callbackUrl) body.set('redirect_uri', config.callbackUrl);

        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (config.clientSecret) {
          headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
        }

        const tokenResp = await fetch(config.tokenUrl, {
          method: 'POST',
          headers,
          body: body.toString(),
        });
        const tokenData = await tokenResp.json();
        if (!tokenResp.ok) {
          throw new Error(tokenData?.error_description || tokenData?.error || 'Failed to fetch tokens.');
        }
        const accessToken = tokenData.access_token;
        if (!accessToken) throw new Error('Missing access token.');

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
        } catch {}

        const expiresIn = Number(tokenData.expires_in);
        const expiresAt = Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : undefined;

        const nextSession: EveSession = {
          characterId,
          characterName,
          corporationId,
          allianceId,
          ownerHash: verifyData.CharacterOwnerHash ? String(verifyData.CharacterOwnerHash) : undefined,
          scopes: tokenData.scope ? String(tokenData.scope) : config.scopes,
          expiresAt,
        };

        setSession(nextSession);
        persistSession(nextSession);
        setStatus('authenticated');
        clearLoginState();

        const returnTo = sessionStorage.getItem(AUTH_RETURN_KEY) || '/';
        sessionStorage.removeItem(AUTH_RETURN_KEY);
        navigate(returnTo, { replace: true });
      } catch (err: any) {
        setError(err?.message || 'Login failed.');
        setStatus('error');
      }
    };

    finishLogin();
  }, [config, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    if (Date.now() > session.expiresAt) {
      logout();
    }
  }, [session, logout]);

  return (
    <AuthContext.Provider
      value={{
        session,
        status,
        error,
        login,
        logout,
        hasAccess,
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
