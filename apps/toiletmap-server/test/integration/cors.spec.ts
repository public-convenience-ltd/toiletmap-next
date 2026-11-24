/**
 * CORS on the REST API: exact origins from ALLOWED_ORIGINS, never with
 * credentials, never on /admin. First-party pages do not need CORS at all
 * (the client proxies /api same-origin; the admin is same-origin), so this
 * only lets the listed sites read public data. The legacy GraphQL endpoint
 * has its own policy (legacy-graphql.http.spec.ts).
 */
import { describe, expect, it } from "vitest";
import { sessionCookie } from "./utils/session";
import { callApi } from "./utils/test-client";

/** Production's ALLOWED_ORIGINS before this change, wildcard included. */
const WITH_WILDCARD =
  "https://www.toiletmap.org.uk,https://toiletmap.org.uk,https://toiletmap-client.gbtoiletmap.workers.dev,https://*.gbtoiletmap.workers.dev";

const request = (
  path: string,
  origin: string,
  env: { ALLOWED_ORIGINS?: string; ENVIRONMENT?: "production" | "preview" | "development" },
  init: RequestInit = {},
) =>
  callApi(
    path,
    { ...init, headers: { Origin: origin, ...(init.headers as Record<string, string>) } },
    { env },
  );

const corsHeaders = (response: Response) =>
  [...response.headers.keys()].filter((name) => name.startsWith("access-control-"));

describe("CORS", () => {
  const preflight = {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Method": "POST" },
  };

  it("never allows a *.workers.dev origin, even when the config still has the wildcard", async () => {
    const env = { ALLOWED_ORIGINS: WITH_WILDCARD, ENVIRONMENT: "production" as const };
    const origin = "https://attacker-toiletmap-client.gbtoiletmap.workers.dev";
    for (const init of [{ headers: { Cookie: sessionCookie({ sub: "auth0|cors" }) } }, preflight]) {
      const response = await request("/api/areas", origin, env, init);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });

  it("allows an exact listed origin to read, without credentials", async () => {
    const env = { ALLOWED_ORIGINS: WITH_WILDCARD, ENVIRONMENT: "production" as const };
    const origin = "https://www.toiletmap.org.uk";
    for (const init of [{}, preflight]) {
      const response = await request("/api/areas", origin, env, init);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });

  it("ignores a bare * entry instead of allowing every origin", async () => {
    const response = await request("/api/areas", "https://evil.example", {
      ALLOWED_ORIGINS: "*",
      ENVIRONMENT: "production",
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("falls back to the localhost origins in development, not to any origin", async () => {
    const evil = await request("/api/areas", "https://evil.example", {
      ALLOWED_ORIGINS: undefined,
      ENVIRONMENT: "development",
    });
    expect(corsHeaders(evil)).toEqual([]);

    const local = await request("/api/areas", "http://localhost:4321", {
      ALLOWED_ORIGINS: undefined,
      ENVIRONMENT: "development",
    });
    expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:4321");
    expect(local.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("allows no origin in public environments when ALLOWED_ORIGINS is unset", async () => {
    const response = await request("/api/areas", "http://localhost:4321", {
      ALLOWED_ORIGINS: undefined,
      ENVIRONMENT: "preview",
    });
    expect(corsHeaders(response)).toEqual([]);
  });

  it("sends no CORS headers on /admin, even to a listed origin", async () => {
    const env = { ALLOWED_ORIGINS: WITH_WILDCARD, ENVIRONMENT: "production" as const };
    for (const path of ["/admin", "/admin/login"]) {
      for (const init of [{}, preflight]) {
        const response = await request(path, "https://www.toiletmap.org.uk", env, init);
        expect(corsHeaders(response), `${init === preflight ? "OPTIONS" : "GET"} ${path}`).toEqual(
          [],
        );
      }
    }
  });
});
