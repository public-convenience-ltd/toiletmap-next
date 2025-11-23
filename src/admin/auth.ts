import { Context } from 'hono';
import { Env } from '../types';
import { setSessionCookies, clearSessionCookies } from '../auth/session';

export const login = async (c: Context<{ Bindings: Env }>) => {
    const authorizationUrl = new URL(`${c.env.AUTH0_ISSUER_BASE_URL}authorize`);
    authorizationUrl.searchParams.set('client_id', c.env.AUTH0_CLIENT_ID);
    authorizationUrl.searchParams.set('redirect_uri', c.env.AUTH0_REDIRECT_URI);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', c.env.AUTH0_SCOPE);
    authorizationUrl.searchParams.set('audience', c.env.AUTH0_AUDIENCE);

    return c.redirect(authorizationUrl.toString());
};

export const callback = async (c: Context<{ Bindings: Env }>) => {
    const code = c.req.query('code');
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
                redirect_uri: c.env.AUTH0_REDIRECT_URI,
            }),
        });

        if (!tokenResponse.ok) {
            const error = await tokenResponse.text();
            console.error('Token exchange failed:', error);
            return c.text('Authentication failed', 401);
        }

        const tokenData = await tokenResponse.json() as {
            access_token: string;
            id_token: string;
            expires_in: number;
        };

        // Get user info from access token
        const userInfoUrl = new URL(`${c.env.AUTH0_ISSUER_BASE_URL}userinfo`);
        const userInfoResponse = await fetch(userInfoUrl.toString(), {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
        });

        if (!userInfoResponse.ok) {
            console.error('Failed to fetch user info');
            return c.text('Failed to retrieve user information', 401);
        }

        const userInfo = await userInfoResponse.json() as {
            sub: string;
            email?: string;
            name?: string;
            nickname?: string;
        };

        // Set session cookies with Auth0 tokens
        setSessionCookies(c, {
            idToken: tokenData.id_token,
            accessToken: tokenData.access_token,
            user: {
                sub: userInfo.sub,
                email: userInfo.email,
                name: userInfo.name,
                nickname: userInfo.nickname,
            },
        });

        return c.redirect('/admin');
    } catch (error) {
        console.error('Callback error:', error);
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
