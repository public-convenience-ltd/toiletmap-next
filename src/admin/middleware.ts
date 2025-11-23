import { Context, Next } from 'hono';
import { Env, AppVariables } from '../types';
import { getSession } from '../auth/session';

/**
 * Authentication middleware for admin routes
 * Checks for valid session and redirects to login if not authenticated
 */
export async function requireAuth(c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) {
    const session = getSession(c);

    if (!session) {
        // No valid session, redirect to login
        return c.redirect('/admin/login');
    }

    // Attach user to context
    c.set('user', session.user);

    await next();
}
