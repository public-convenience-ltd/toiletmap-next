import { Context } from 'hono';
import { Env } from '../../types';

/**
 * Session data structure - stores Auth0 tokens directly
 */
export interface SessionData {
    idToken: string;
    accessToken: string;
    user: {
        sub: string;
        email?: string;
        name?: string;
        nickname?: string;
    };
}

/**
 * Sets session cookies with Auth0 tokens
 */
export function setSessionCookies(c: Context, data: SessionData) {
    const cookieOptions = 'Path=/admin; HttpOnly; SameSite=Lax; Max-Age=86400'; // 24 hours

    // Store both tokens in separate cookies
    c.header('Set-Cookie', `id_token=${data.idToken}; ${cookieOptions}`, { append: true });
    c.header('Set-Cookie', `access_token=${data.accessToken}; ${cookieOptions}`, { append: true });

    // Store user info as JSON
    const userInfo = btoa(JSON.stringify(data.user));
    c.header('Set-Cookie', `user_info=${userInfo}; ${cookieOptions}`, { append: true });
}

/**
 * Clears all session cookies
 */
export function clearSessionCookies(c: Context) {
    const clearOptions = 'Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0';
    c.header('Set-Cookie', `id_token=; ${clearOptions}`, { append: true });
    c.header('Set-Cookie', `access_token=; ${clearOptions}`, { append: true });
    c.header('Set-Cookie', `user_info=; ${clearOptions}`, { append: true });
}

/**
 * Gets session data from request cookies
 */
export function getSession(c: Context): SessionData | null {
    const cookieHeader = c.req.header('Cookie');
    if (!cookieHeader) {
        return null;
    }

    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, string>);

    const idToken = cookies['id_token'];
    const accessToken = cookies['access_token'];
    const userInfo = cookies['user_info'];

    if (!idToken || !accessToken || !userInfo) {
        return null;
    }

    try {
        const user = JSON.parse(atob(userInfo));
        return {
            idToken,
            accessToken,
            user,
        };
    } catch (error) {
        console.error('Failed to parse user info:', error);
        return null;
    }
}
