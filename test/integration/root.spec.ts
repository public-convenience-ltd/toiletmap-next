import { describe, expect, it } from 'vitest';
import { callApi } from './utils/test-client';

describe('root endpoints', () => {
  it('returns health information on GET /', async () => {
    const response = await callApi('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('toiletmap-hono-api');
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('exposes the OpenAPI document', async () => {
    const response = await callApi('/docs/openapi.json');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.openapi).toMatch(/^3\./);
    expect(body.info?.title).toBeTruthy();
  });

  it('renders Swagger UI HTML', async () => {
    const response = await callApi('/docs');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('SwaggerUI');
  });

  it('returns the API 404 payload for unknown routes', async () => {
    const response = await callApi('/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: 'Route not found' });
  });
});
