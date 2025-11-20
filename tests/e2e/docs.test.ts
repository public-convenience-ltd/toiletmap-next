import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../../src/docs/openapi';
import { testClient } from './context';

/** Protects onboarding surfaces: OpenAPI JSON, and Swagger UI. */
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
});
