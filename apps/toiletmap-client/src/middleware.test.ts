import { env } from "cloudflare:workers";
import type { APIContext } from "astro";
import { afterEach, describe, expect, it } from "vitest";
import { onRequest } from "./middleware";
import { knownInlineScriptHashes } from "./utils/inlineScripts";
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, scriptHash } from "./utils/securityHeaders";

/** A minimal stand-in for Astro's APIContext: the middleware only reads `url`. */
const contextFor = (path: string) =>
  ({ url: new URL(path, "https://www.toiletmap.org.uk") }) as unknown as APIContext;

const run = async (path: string, response: Response) =>
  (await onRequest(contextFor(path), async () => response)) as Response;

const vars = env as unknown as Record<string, unknown>;

afterEach(() => {
  vars.ENVIRONMENT = undefined;
});

describe("middleware", () => {
  it("adds the security headers, allowing the site's own inline scripts only", async () => {
    vars.ENVIRONMENT = "production";
    const page = "<script>injected()</script>";
    const res = await run(
      "/loos/abc",
      new Response(page, { headers: { "Content-Type": "text/html" } }),
    );
    expect(await res.text()).toBe(page);
    const csp = res.headers.get(CSP_HEADER) ?? res.headers.get(CSP_REPORT_ONLY_HEADER) ?? "";
    for (const hash of await knownInlineScriptHashes()) expect(csp).toContain(hash);
    expect(csp).not.toContain(await scriptHash("injected()"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // Vitest runs as `astro dev` (import.meta.env.DEV): no HSTS, and hot reload may connect.
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });
});
