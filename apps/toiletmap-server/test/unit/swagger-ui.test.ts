import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { SWAGGER_UI_ASSETS, SWAGGER_UI_VERSION, swaggerUiPage } from "../../src/docs/swagger-ui";

const renderDocs = async () => {
  const app = new Hono();
  app.get("/api/docs", swaggerUiPage("/api/docs/openapi.json"));
  const response = await app.request("/api/docs");
  expect(response.status).toBe(200);
  return response.text();
};

describe("/api/docs Swagger UI", () => {
  it("pins an exact swagger-ui-dist version", () => {
    expect(SWAGGER_UI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SWAGGER_UI_ASSETS.css.href).toContain(`/swagger-ui-dist@${SWAGGER_UI_VERSION}/`);
    expect(SWAGGER_UI_ASSETS.js.src).toContain(`/swagger-ui-dist@${SWAGGER_UI_VERSION}/`);
  });

  it("loads every CDN asset at that version with a SHA-384 integrity hash", async () => {
    const html = await renderDocs();
    const tags = html.match(/<(?:script|link)\b[^>]*cdn\.jsdelivr\.net[^>]*>/g) ?? [];
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toContain(`swagger-ui-dist@${SWAGGER_UI_VERSION}/`);
      expect(tag).toMatch(/integrity="sha384-[A-Za-z0-9+/]{64}"/);
      expect(tag).toContain('crossorigin="anonymous"');
    }
    expect(html).toContain(`integrity="${SWAGGER_UI_ASSETS.js.integrity}"`);
    expect(html).toContain(`integrity="${SWAGGER_UI_ASSETS.css.integrity}"`);
    // An unversioned URL would resolve to whatever is latest on the CDN.
    expect(html).not.toMatch(/swagger-ui-dist(?!@)/);
    expect(html).toContain('url: "/api/docs/openapi.json"');
  });
});
