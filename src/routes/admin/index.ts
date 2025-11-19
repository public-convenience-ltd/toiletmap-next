import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { validate } from '../../common/validator';
import { mapDataSchema, suspiciousActivitySchema } from './schemas';
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
adminRouter.get(
  '/api/loos/map',
  requireAuth,
  requireAdminRole,
  validate('query', mapDataSchema),
  (c) =>
    handleRoute(c, 'admin.loos.map', async () => {
      const filters = c.req.valid('query');
      const loos = await adminService.getMapData(filters);

      return c.json({
        data: loos,
        count: loos.length,
      });
    }),
);

/**
 * GET /admin/api/suspicious-activity
 * Returns suspicious activity across multiple categories
 * Requires: Admin role (access:admin)
 * Query params:
 *   - hoursWindow: number (optional, default: 24) - time window to analyze
 *   - minRapidUpdates: number (optional, default: 5) - minimum updates to flag as rapid
 *   - minLocationChangeMeters: number (optional, default: 1000) - minimum distance to flag location change
 *   - minMassDeactivations: number (optional, default: 5) - minimum deactivations to flag as mass
 */
adminRouter.get(
  '/api/suspicious-activity',
  requireAuth,
  requireAdminRole,
  validate('query', suspiciousActivitySchema),
  (c) =>
    handleRoute(c, 'admin.suspicious-activity', async () => {
      const options = c.req.valid('query');
      const activity = await adminService.getSuspiciousActivity(options);
      return c.json(activity);
    }),
);

/**
 * GET /admin/api/contributors/leaderboard
 * Returns contributor leaderboard with rankings and stats
 * Requires: Admin role (access:admin)
 */
adminRouter.get('/api/contributors/leaderboard', requireAuth, requireAdminRole, (c) =>
  handleRoute(c, 'admin.contributors.leaderboard', async () => {
    const leaderboard = await adminService.getContributorLeaderboard();
    return c.json(leaderboard);
  }),
);

/**
 * GET /admin/api/contributors/:contributorId
 * Returns detailed statistics for a specific contributor
 * Requires: Admin role (access:admin)
 */
adminRouter.get('/api/contributors/:contributorId', requireAuth, requireAdminRole, (c) =>
  handleRoute(c, 'admin.contributors.details', async () => {
    const contributorId = c.req.param('contributorId');
    const stats = await adminService.getContributorStats(contributorId);

    if (!stats) {
      return c.json({ error: 'Contributor not found or has no activity' }, 404);
    }

    return c.json(stats);
  }),
);

// UI routes (no auth required for the HTML page itself, auth handled by frontend)
adminRouter.get('/', (c) => c.html(adminPageHtml));

// Serve static files from admin-explorer
adminRouter.use('/*', serveStatic({
  root: './admin-explorer',
  rewriteRequestPath: (path) => path.replace(/^\/admin/, ''),
}));

// Fallback for SPA routing (if needed, though currently we mostly rely on hash routing or simple navigation)
adminRouter.get('/*', (c) => c.html(adminPageHtml));
