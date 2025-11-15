import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { env } from '../../env';

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

adminRouter.get('/', (c) => c.html(adminPageHtml));
adminRouter.get('/*', (c) => c.html(adminPageHtml));
