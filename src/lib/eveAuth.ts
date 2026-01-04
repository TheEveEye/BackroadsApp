export type ToolKey = 'observatories' | 'scanner' | 'bridgePlanner';

export type EveSession = {
  characterId: number;
  characterName: string;
  corporationId?: number | null;
  allianceId?: number | null;
  ownerHash?: string;
  expiresAt?: number;
  scopes?: string;
};

export type ToolWhitelist = {
  allianceIds: number[];
  corporationIds: number[];
  characterIds: number[];
};

export type AuthConfig = {
  clientId: string;
  clientSecret?: string;
  callbackUrl?: string;
  scopes: string;
  authorizeUrl: string;
  tokenUrl: string;
  verifyUrl: string;
};

export const AUTH_STORAGE_KEY = 'br.eve.session.v1';
export const AUTH_STATE_KEY = 'br.eve.oauth_state.v1';
export const AUTH_VERIFIER_KEY = 'br.eve.pkce_verifier.v1';
export const AUTH_RETURN_KEY = 'br.eve.return_to.v1';

export const TOOL_LABELS: Record<ToolKey, string> = {
  observatories: 'Observatory Finder',
  scanner: 'Wormhole Scanner',
  bridgePlanner: 'Bridge Planner',
};

const TOOL_ENV_PREFIX: Record<ToolKey, string> = {
  observatories: 'OBSERVATORIES',
  scanner: 'SCANNER',
  bridgePlanner: 'BRIDGE_PLANNER',
};

const parseIdList = (value?: string): number[] => {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
};

const isWhitelistEnabled = (): boolean => {
  const env = (import.meta as any).env || {};
  const raw = String(env.VITE_WHITELIST_ENABLED ?? 'true').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
};

export const getToolWhitelist = (tool: ToolKey): ToolWhitelist => {
  const env = (import.meta as any).env || {};
  const prefix = TOOL_ENV_PREFIX[tool];
  return {
    allianceIds: parseIdList(env[`VITE_WHITELIST_${prefix}_ALLIANCE_IDS`]),
    corporationIds: parseIdList(env[`VITE_WHITELIST_${prefix}_CORPORATION_IDS`]),
    characterIds: parseIdList(env[`VITE_WHITELIST_${prefix}_CHARACTER_IDS`]),
  };
};

export const isWhitelisted = (session: EveSession | null, tool: ToolKey): boolean => {
  if (!session) return false;
  if (!isWhitelistEnabled()) return true;
  const lists = getToolWhitelist(tool);
  const hasLists = lists.allianceIds.length || lists.corporationIds.length || lists.characterIds.length;
  if (!hasLists) return false;
  const characterMatch = lists.characterIds.includes(session.characterId);
  const corporationMatch = session.corporationId ? lists.corporationIds.includes(session.corporationId) : false;
  const allianceMatch = session.allianceId ? lists.allianceIds.includes(session.allianceId) : false;
  return characterMatch || corporationMatch || allianceMatch;
};

export const getAuthConfig = (): AuthConfig => {
  const env = (import.meta as any).env || {};
  const base = env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const callbackUrl = env.VITE_EVE_CALLBACK_URL || (typeof window !== 'undefined' ? `${window.location.origin}${normalizedBase}auth/callback` : '');

  return {
    clientId: env.VITE_EVE_CLIENT_ID || '',
    clientSecret: env.VITE_EVE_CLIENT_SECRET || '',
    callbackUrl,
    scopes: env.VITE_EVE_SCOPES || 'publicData',
    authorizeUrl: env.VITE_EVE_AUTH_URL || 'https://login.eveonline.com/v2/oauth/authorize',
    tokenUrl: env.VITE_EVE_TOKEN_URL || 'https://login.eveonline.com/v2/oauth/token',
    verifyUrl: env.VITE_EVE_VERIFY_URL || 'https://login.eveonline.com/oauth/verify',
  };
};
