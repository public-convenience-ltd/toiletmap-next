import { logger } from '../utils/logger';

const USERINFO_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

type CacheEntry = {
  payload: UserInfoResponse;
  expiresAt: number;
};

const userInfoCache = new Map<string, CacheEntry>();

const encoder = new TextEncoder();

const hashToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const getCachedUserInfo = (key: string): UserInfoResponse | null => {
  const entry = userInfoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userInfoCache.delete(key);
    return null;
  }
  return entry.payload;
};

const setCachedUserInfo = (key: string, payload: UserInfoResponse) => {
  userInfoCache.set(key, {
    payload,
    expiresAt: Date.now() + USERINFO_CACHE_TTL_MS,
  });
};

const normalizeIssuer = (issuerBaseUrl: string) => {
  if (!issuerBaseUrl) {
    throw new Error('Missing Auth0 issuer base URL');
  }
  return issuerBaseUrl.endsWith('/')
    ? issuerBaseUrl
    : `${issuerBaseUrl}/`;
};

type UserInfoResponse = {
  sub: string;
  email?: string;
  name?: string;
  nickname?: string;
  [key: string]: unknown;
};

export const fetchUserInfo = async (
  accessToken: string | null | undefined,
  issuerBaseUrl: string,
): Promise<UserInfoResponse | null> => {
  if (!accessToken) return null;

  try {
    const cacheKey = await hashToken(accessToken);
    const cached = getCachedUserInfo(cacheKey);
    if (cached) {
      return cached;
    }

    const userInfoUrl = `${normalizeIssuer(issuerBaseUrl)}userinfo`;
    const response = await fetch(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      logger.warn('Auth0 userinfo request failed', {
        status: response.status,
        statusText: response.statusText,
        endpoint: '/userinfo',
      });
      return null;
    }

    const payload = (await response.json()) as UserInfoResponse;
    if (!payload?.sub) {
      logger.warn('Auth0 userinfo response missing "sub" claim', {
        endpoint: '/userinfo',
      });
      return null;
    }

    setCachedUserInfo(cacheKey, payload);
    return payload;
  } catch (error) {
    if (error instanceof Error) {
      logger.logError(error, { endpoint: '/userinfo' });
    } else {
      logger.error('Failed to fetch Auth0 userinfo', {
        endpoint: '/userinfo',
        errorMessage: String(error),
      });
    }
    return null;
  }
};
