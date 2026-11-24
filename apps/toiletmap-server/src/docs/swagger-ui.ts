import { swaggerUI } from "@hono/swagger-ui";

/**
 * Swagger UI for /api/docs, loaded from jsDelivr at an exact version with
 * Subresource Integrity, so a changed or compromised file on the CDN is not
 * run on this origin (where the admin lives). The hashes are of the exact
 * published files (jsDelivr serves the npm tarball's bytes).
 *
 * To upgrade: pick a version, then for each file run
 *   curl -sSfL https://cdn.jsdelivr.net/npm/swagger-ui-dist@<version>/<file> \
 *     | openssl dgst -sha384 -binary | openssl base64 -A
 * and update the version and both hashes together.
 */
export const SWAGGER_UI_VERSION = "5.34.1";

const SWAGGER_UI_BASE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

export const SWAGGER_UI_ASSETS = {
  css: {
    href: `${SWAGGER_UI_BASE}/swagger-ui.css`,
    integrity: "sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF",
  },
  js: {
    src: `${SWAGGER_UI_BASE}/swagger-ui-bundle.js`,
    integrity: "sha384-XFYN47VzPiDY6qPtxYKg0nqUeW/upo20xf1j2SUE7gT/i35FJB4cuS/71Iegzk8Z",
  },
} as const;

/** The /api/docs page for the OpenAPI document at `specUrl`. */
export const swaggerUiPage = (specUrl: string) =>
  swaggerUI({
    title: "Toilet Map API",
    url: specUrl,
    // The library's own markup has no integrity attributes, so render it here.
    manuallySwaggerUIHtml: () => `
    <div>
      <div id="swagger-ui"></div>
      <link rel="stylesheet" href="${SWAGGER_UI_ASSETS.css.href}" integrity="${SWAGGER_UI_ASSETS.css.integrity}" crossorigin="anonymous" />
      <script src="${SWAGGER_UI_ASSETS.js.src}" integrity="${SWAGGER_UI_ASSETS.js.integrity}" crossorigin="anonymous"></script>
      <script>
        window.onload = () => {
          window.ui = SwaggerUIBundle({ dom_id: "#swagger-ui", url: ${JSON.stringify(specUrl)} });
        };
      </script>
    </div>
  `,
  });
