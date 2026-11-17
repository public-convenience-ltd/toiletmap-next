import { describe, expect, it } from "vitest";
import { canWriteDirectlyFromToken, sessionCanWriteDirectly } from "./permissions";

const b64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (claims: Record<string, unknown>) =>
  `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.signature`;

const cookies = (values: Record<string, string>) => ({
  get: (name: string) => (name in values ? { value: values[name] } : undefined),
});

describe("canWriteDirectlyFromToken", () => {
  it("is true for report:loo or access:admin in the permissions claim", () => {
    expect(canWriteDirectlyFromToken(token({ permissions: ["report:loo"] }))).toBe(true);
    expect(canWriteDirectlyFromToken(token({ permissions: ["access:admin"] }))).toBe(true);
  });

  it("is false for other permissions, no claim, or an unreadable token", () => {
    expect(canWriteDirectlyFromToken(token({ permissions: ["read:loo"] }))).toBe(false);
    expect(canWriteDirectlyFromToken(token({ permissions: "report:loo" }))).toBe(false);
    expect(canWriteDirectlyFromToken(token({ sub: "auth0|1" }))).toBe(false);
    expect(canWriteDirectlyFromToken("not-a-jwt")).toBe(false);
    expect(canWriteDirectlyFromToken("a.b!!.c")).toBe(false);
    expect(canWriteDirectlyFromToken(undefined)).toBe(false);
  });
});

describe("sessionCanWriteDirectly", () => {
  it("needs both a signed-in session and a trusted token", () => {
    const trusted = token({ permissions: ["report:loo"] });
    expect(sessionCanWriteDirectly(cookies({ user_info: "x", access_token: trusted }))).toBe(true);
    expect(sessionCanWriteDirectly(cookies({ access_token: trusted }))).toBe(false);
    expect(
      sessionCanWriteDirectly(
        cookies({ user_info: "x", access_token: token({ permissions: [] }) }),
      ),
    ).toBe(false);
  });
});
