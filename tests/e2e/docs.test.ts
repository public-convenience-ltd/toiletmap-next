import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../../src/docs/openapi';
import { env } from '../../src/env';
import { testClient } from './context';

/** Protects onboarding surfaces: OpenAPI JSON, Swagger UI, and admin shell. */
describe('Documentation & admin routes', () => {
  it('serves the OpenAPI document via /docs/openapi.json', async () => {
    const { response, data } = await testClient.json<typeof openApiDocument>(
      '/docs/openapi.json',
    );

    expect(response.status).toBe(200);
    expect(data.openapi).toBe(openApiDocument.openapi);
    expect(data.info).toEqual(openApiDocument.info);
    expect(data.paths).toEqual(openApiDocument.paths);
    expect(data.components?.schemas).toEqual(
      openApiDocument.components?.schemas,
    );
  });

  it('renders the Swagger UI shell at /docs', async () => {
    const response = await testClient.fetch('/docs');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('id="swagger-ui"');
    expect(html).toContain('/docs/openapi.json');
  });

  it('renders the admin explorer placeholder with templated Auth0 data', async () => {
    const response = await testClient.fetch('/admin');
    const html = await response.text();

    const expectedEnabled = Boolean(
      env.auth0.dataExplorer.clientId &&
        env.auth0.audience &&
        env.auth0.issuerBaseUrl,
    );

    expect(response.status).toBe(200);
    expect(html).not.toContain('__AUTH0_ENABLED__');
    expect(html).toContain(
      `data-auth0-enabled="${expectedEnabled ? 'true' : 'false'}"`,
    );
    expect(html).toContain(`data-auth0-audience="${env.auth0.audience}"`);
  });
});
