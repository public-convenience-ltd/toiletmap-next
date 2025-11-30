import { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Env } from '../types';
import { setSessionCookies, clearSessionCookies } from '../auth/session';
import { fetchUserInfo } from '../auth/userinfo';
import { authenticateToken } from '../auth/verify';
import { logger } from '../utils/logger';

const STATE_COOKIE_NAME = 'auth_state';
const NONCE_COOKIE_NAME = 'auth_nonce';
const EPHEMERAL_COOKIE_TTL_SECONDS = 300; // 5 minutes
const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
};

const resolveRedirectUri = (c: Context<{ Bindings: Env }>) => {
    try {
        const { origin } = new URL(c.req.url);
        return `${origin}/admin/callback`;
    } catch (error) {
        logger.warn('Failed to derive dynamic Auth0 redirect URI, falling back to configured value', {
            errorMessage: error instanceof Error ? error.message : String(error),
        });
        return c.env.AUTH0_REDIRECT_URI;
    }
};

const generateRandomToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const setEphemeralCookie = (c: Context<{ Bindings: Env }>, name: string, value: string) => {
    setCookie(c, name, value, {
        ...cookieOptions,
        maxAge: EPHEMERAL_COOKIE_TTL_SECONDS,
    });
};

const clearEphemeralCookie = (c: Context<{ Bindings: Env }>, name: string) => {
    deleteCookie(c, name, cookieOptions);
};

const constantTimeEquals = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
};

export const login = async (c: Context<{ Bindings: Env }>) => {
    const authorizationUrl = new URL(`${c.env.AUTH0_ISSUER_BASE_URL}authorize`);
    const state = generateRandomToken();
    const nonce = generateRandomToken();
    const redirectUri = resolveRedirectUri(c);

    setEphemeralCookie(c, STATE_COOKIE_NAME, state);
    setEphemeralCookie(c, NONCE_COOKIE_NAME, nonce);

    authorizationUrl.searchParams.set('client_id', c.env.AUTH0_CLIENT_ID);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', c.env.AUTH0_SCOPE);
    authorizationUrl.searchParams.set('audience', c.env.AUTH0_AUDIENCE);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);

    return c.redirect(authorizationUrl.toString());
};

export const callback = async (c: Context<{ Bindings: Env }>) => {
    const code = c.req.query('code');
    const returnedState = c.req.query('state');
    const storedState = getCookie(c, STATE_COOKIE_NAME);
    const storedNonce = getCookie(c, NONCE_COOKIE_NAME);
    const redirectUri = resolveRedirectUri(c);

    clearEphemeralCookie(c, STATE_COOKIE_NAME);
    clearEphemeralCookie(c, NONCE_COOKIE_NAME);

    if (!returnedState || !storedState || !constantTimeEquals(returnedState, storedState)) {
        logger.warn('OAuth state verification failed', {
            hasReturnedState: Boolean(returnedState),
            hasStoredState: Boolean(storedState),
        });
        return c.text('Invalid authentication state', 400);
    }

    if (!storedNonce) {
        logger.warn('OAuth nonce missing from cookie');
        return c.text('Invalid authentication nonce', 400);
    }

    if (!code) {
        return c.text('Missing authorization code', 400);
    }

    try {
        // Exchange code for access token using client secret
        const tokenUrl = new URL(`${c.env.AUTH0_ISSUER_BASE_URL}oauth/token`);
        const tokenResponse = await fetch(tokenUrl.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: c.env.AUTH0_CLIENT_ID,
                client_secret: c.env.AUTH0_CLIENT_SECRET,
                code,
                redirect_uri: redirectUri,
            }),
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            logger.error('Auth0 token exchange failed', {
                status: tokenResponse.status,
                statusText: tokenResponse.statusText,
                errorText,
            });
            return c.text('Authentication failed', 401);
        }

        const tokenData = await tokenResponse.json() as {
            access_token: string;
            id_token: string;
            expires_in: number;
        };

        let idTokenUser;
        try {
            idTokenUser = await authenticateToken(
                tokenData.id_token,
                c.env,
                c.env.AUTH0_CLIENT_ID,
            );
        } catch (error) {
            logger.error('Auth0 id_token verification failed', {
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            return c.text('Authentication failed', 401);
        }

        const nonceClaim = (idTokenUser as Record<string, unknown>).nonce;
        const tokenNonce = typeof nonceClaim === 'string' ? nonceClaim : null;

        if (!tokenNonce || !constantTimeEquals(tokenNonce, storedNonce)) {
            logger.warn('Invalid nonce in id_token', {
                hasNonce: Boolean(tokenNonce),
            });
            return c.text('Invalid authentication nonce', 401);
        }

        // Get user info from Auth0
        const userInfo = await fetchUserInfo(
            tokenData.access_token,
            c.env.AUTH0_ISSUER_BASE_URL,
        );

        const sessionUser = userInfo ?? {
            sub: idTokenUser.sub,
            email: idTokenUser.email,
            name: idTokenUser.name,
            nickname: idTokenUser.nickname,
        };

        // Set session cookies with Auth0 tokens
        setSessionCookies(c, {
            idToken: tokenData.id_token,
            accessToken: tokenData.access_token,
            user: sessionUser,
        });

        return c.redirect('/admin');
    } catch (error) {
        if (error instanceof Error) {
            logger.logError(error, {});
        } else {
            logger.error('Admin auth callback error', {
                errorMessage: String(error),
            });
        }
        return c.text('Authentication error', 500);
    }
};

export const logout = async (c: Context<{ Bindings: Env }>) => {
    // Clear session cookies
    clearSessionCookies(c);

    // Optionally redirect to Auth0 logout
    // For now, just redirect to home
    return c.redirect('/');
};
