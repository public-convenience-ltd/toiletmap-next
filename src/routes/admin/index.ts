import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { env } from '../../env';
import { requireAuth } from '../../middleware/require-auth';
import { requireAdminRole } from '../../middleware/require-admin-role';
import { adminService } from '../../services/admin.service';
import { handleRoute } from '../shared/route-helpers';

const projectRoot = resolve(__dirname, '../../..');
const adminExplorerPath = join(projectRoot, 'admin-explorer', 'index.html');
const adminTemplate = readFileSync(adminExplorerPath, 'utf8');

const escapeHtmlAttr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const attr = (value: string | null | undefined): string =>
  value ? escapeHtmlAttr(value) : '';

const issuerBase = env.auth0.issuerBaseUrl.replace(/\/+$/, '');
const authorizeUrl = issuerBase ? `${issuerBase}/authorize` : '';

const auth0ClientId = env.auth0.dataExplorer.clientId ?? '';
const auth0Scope = env.auth0.dataExplorer.scope;
const auth0RedirectUri = env.auth0.dataExplorer.redirectUri ?? '';
const auth0Audience = env.auth0.audience;

const auth0Enabled =
  Boolean(auth0ClientId) && Boolean(authorizeUrl) && Boolean(auth0Audience);

const adminPageHtml = adminTemplate
  .replace(/__AUTH0_ENABLED__/g, auth0Enabled ? 'true' : 'false')
  .replace(/__AUTH0_CLIENT_ID__/g, attr(auth0ClientId))
  .replace(/__AUTH0_AUTHORIZE_URL__/g, attr(authorizeUrl))
  .replace(/__AUTH0_AUDIENCE__/g, attr(auth0Audience))
  .replace(/__AUTH0_SCOPE__/g, attr(auth0Scope))
  .replace(/__AUTH0_REDIRECT_URI__/g, attr(auth0RedirectUri));

export const adminRouter = new Hono<{ Variables: AppVariables }>();

/**
 * GET /admin/api/stats
 * Returns comprehensive statistics for the admin dashboard
 * Requires: Admin role (access:admin)
 */
adminRouter.get('/api/stats', requireAuth, requireAdminRole, (c) =>
  handleRoute(c, 'admin.stats', async () => {
    const stats = await adminService.getStatistics();
    return c.json(stats);
  }),
);

/**
 * GET /admin/api/loos/map
 * Returns compressed loo data optimized for map visualization
 * Requires: Admin role (access:admin)
 * Query params:
 *   - active: boolean (optional) - filter by active status
 *   - accessible: boolean (optional) - filter by accessibility
 */
adminRouter.get('/api/loos/map', requireAuth, requireAdminRole, (c) =>
  handleRoute(c, 'admin.loos.map', async () => {
    const activeParam = c.req.query('active');
    const accessibleParam = c.req.query('accessible');

    const filters: { active?: boolean; accessible?: boolean } = {};

    if (activeParam === 'true') filters.active = true;
    if (activeParam === 'false') filters.active = false;
    if (accessibleParam === 'true') filters.accessible = true;
    if (accessibleParam === 'false') filters.accessible = false;

    const loos = await adminService.getMapData(filters);

    return c.json({
      data: loos,
      count: loos.length,
    });
  }),
);

// UI routes (no auth required for the HTML page itself, auth handled by frontend)
adminRouter.get('/', (c) => c.html(adminPageHtml));
adminRouter.get('/*', (c) => c.html(adminPageHtml));
