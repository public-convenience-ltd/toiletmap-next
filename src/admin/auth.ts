import { Context } from 'hono';
import { Env } from '../types';

export const login = async (c: Context<{ Bindings: Env }>) => {
    const authorizationUrl = new URL(`${c.env.AUTH0_ISSUER_BASE_URL}authorize`);
    authorizationUrl.searchParams.set('client_id', c.env.AUTH0_CLIENT_ID);
    authorizationUrl.searchParams.set('redirect_uri', c.env.AUTH0_REDIRECT_URI);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', c.env.AUTH0_SCOPE);

    return c.redirect(authorizationUrl.toString());
};

export const callback = async (c: Context<{ Bindings: Env }>) => {
    const code = c.req.query('code');
    if (!code) {
        return c.text('Missing code', 400);
    }

    // TODO: Exchange code for token and set session
    return c.redirect('/admin');
};

export const logout = async (c: Context<{ Bindings: Env }>) => {
    // TODO: Clear session
    return c.redirect('/');
};
