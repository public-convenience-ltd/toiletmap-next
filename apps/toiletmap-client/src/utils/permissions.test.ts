import { describe, expect, it } from "vitest";
import { canWriteDirectlyFromToken, sessionCanWriteDirectly } from "./permissions";

const b64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (claims: Record<string, unknown>) =>
  `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.signature`;

const cookies = (values: Record<string, string>) => ({
  get: (name: string) => (name in values ? { value: values[name] } : undefined),
});

const NOW_MS = Date.parse("2026-11-17T09:00:00.000Z");
const NOW_S = NOW_MS / 1000;

describe("canWriteDirectlyFromToken", () => {
  it("is true for any unexpired token, whatever its permissions", () => {
    expect(canWriteDirectlyFromToken(token({ exp: NOW_S + 60 }), NOW_MS)).toBe(true);
    expect(canWriteDirectlyFromToken(token({ exp: NOW_S + 60, permissions: [] }), NOW_MS)).toBe(
      true,
    );
    expect(
      canWriteDirectlyFromToken(token({ exp: NOW_S + 60, permissions: ["access:admin"] }), NOW_MS),
    ).toBe(true);
  });

  it("is false for an expired token", () => {
    expect(canWriteDirectlyFromToken(token({ exp: NOW_S }), NOW_MS)).toBe(false);
    expect(canWriteDirectlyFromToken(token({ exp: NOW_S - 1 }), NOW_MS)).toBe(false);
  });

  it("is false without a readable exp, or for an unreadable token", () => {
    expect(canWriteDirectlyFromToken(token({ sub: "auth0|1" }), NOW_MS)).toBe(false);
    expect(canWriteDirectlyFromToken(token({ exp: "tomorrow" }), NOW_MS)).toBe(false);
    expect(canWriteDirectlyFromToken("not-a-jwt", NOW_MS)).toBe(false);
    expect(canWriteDirectlyFromToken("a.b!!.c", NOW_MS)).toBe(false);
    expect(canWriteDirectlyFromToken(undefined, NOW_MS)).toBe(false);
  });

  it("uses the current time by default", () => {
    const inAnHour = Math.floor(Date.now() / 1000) + 3600;
    expect(canWriteDirectlyFromToken(token({ exp: inAnHour }))).toBe(true);
    expect(canWriteDirectlyFromToken(token({ exp: 1 }))).toBe(false);
  });
});

describe("sessionCanWriteDirectly", () => {
  const live = token({ exp: NOW_S + 3600 });

  it("is true for a signed-in session with an unexpired access token", () => {
    expect(sessionCanWriteDirectly(cookies({ user_info: "x", access_token: live }), NOW_MS)).toBe(
      true,
    );
  });

  it("is false when not signed in, or the access token is missing or expired", () => {
    expect(sessionCanWriteDirectly(cookies({ access_token: live }), NOW_MS)).toBe(false);
    expect(sessionCanWriteDirectly(cookies({ user_info: "", access_token: live }), NOW_MS)).toBe(
      false,
    );
    expect(sessionCanWriteDirectly(cookies({ user_info: "x" }), NOW_MS)).toBe(false);
    expect(
      sessionCanWriteDirectly(
        cookies({ user_info: "x", access_token: token({ exp: NOW_S - 60 }) }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(sessionCanWriteDirectly(cookies({}), NOW_MS)).toBe(false);
  });
});
