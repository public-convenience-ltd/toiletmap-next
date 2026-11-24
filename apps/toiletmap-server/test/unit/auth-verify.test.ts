import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __jwksTestUtils,
  authenticateToken,
  JwksUnavailableError,
  matchesAudience,
  normalizeUser,
} from "../../../../packages/auth/src/verify";

describe("matchesAudience", () => {
  it("never matches an empty expected audience", () => {
    expect(matchesAudience("anything", "")).toBe(false);
    expect(matchesAudience("", "")).toBe(false);
  });

  it("matches an exact string audience", () => {
    expect(matchesAudience("https://api.example.com", "https://api.example.com")).toBe(true);
  });

  it("returns false for a non-matching string audience", () => {
    expect(matchesAudience("https://api.example.com", "https://other.example.com")).toBe(false);
  });

  it("matches when the expected value is in an array audience", () => {
    expect(
      matchesAudience(
        ["https://api.example.com", "https://other.example.com"],
        "https://api.example.com",
      ),
    ).toBe(true);
  });

  it("returns false when the expected value is not in an array audience", () => {
    expect(matchesAudience(["https://api.example.com"], "https://other.example.com")).toBe(false);
  });

  it("treats a space- or comma-separated string as one audience", () => {
    expect(
      matchesAudience(
        "https://api.example.com https://other.example.com",
        "https://other.example.com",
      ),
    ).toBe(false);
    expect(
      matchesAudience(
        "https://api.example.com,https://other.example.com",
        "https://other.example.com",
      ),
    ).toBe(false);
  });

  it("returns false for non-string, non-array audience", () => {
    expect(matchesAudience(42, "https://api.example.com")).toBe(false);
    expect(matchesAudience(null, "https://api.example.com")).toBe(false);
    expect(matchesAudience([42], "https://api.example.com")).toBe(false);
  });
});

describe("authenticateToken", () => {
  const ISSUER = "https://tenant.example/";
  const AUDIENCE = "https://api.example";
  const JWKS_URI = `${ISSUER}.well-known/jwks.json`;
  const env = { AUTH0_ISSUER_BASE_URL: ISSUER, AUTH0_AUDIENCE: AUDIENCE };

  const keyPair = (kid: string) => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = {
      ...(publicKey.export({ format: "jwk" }) as Record<string, string>),
      kid,
      alg: "RS256",
    };
    return { privateKey, jwk, kid };
  };
  const primary = keyPair("key-1");

  const sign = (claims: Record<string, unknown>, key = primary) => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const data = `${encode({ alg: "RS256", typ: "JWT", kid: key.kid })}.${encode(claims)}`;
    return `${data}.${createSign("RSA-SHA256").update(data).sign(key.privateKey, "base64url")}`;
  };
  const now = () => Math.floor(Date.now() / 1000);
  const validClaims = () => ({
    sub: "auth0|abc",
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now(),
    exp: now() + 3600,
  });

  let fetchMock: ReturnType<typeof vi.fn>;
  const serveKeys = (keys: Record<string, string>[]) =>
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ keys })));

  beforeEach(() => {
    __jwksTestUtils.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    serveKeys([primary.jwk]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("accepts a valid token", async () => {
    const user = await authenticateToken(sign(validClaims()), env);
    expect(user.sub).toBe("auth0|abc");
    expect(fetchMock).toHaveBeenCalledWith(JWKS_URI);
  });

  it("requires exp", async () => {
    const { exp: _exp, ...claims } = validClaims();
    await expect(authenticateToken(sign(claims), env)).rejects.toThrow("exp");
  });

  it("refuses an expired token", async () => {
    await expect(
      authenticateToken(sign({ ...validClaims(), exp: now() - 10 }), env),
    ).rejects.toThrow();
  });

  it("refuses every token when no audience is configured", async () => {
    await expect(
      authenticateToken(sign(validClaims()), { ...env, AUTH0_AUDIENCE: "" }),
    ).rejects.toThrow("audience");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a token for another audience or issuer", async () => {
    await expect(
      authenticateToken(sign({ ...validClaims(), aud: "https://other.example" }), env),
    ).rejects.toThrow();
    await expect(
      authenticateToken(sign({ ...validClaims(), iss: "https://evil.example/" }), env),
    ).rejects.toThrow();
    await expect(
      authenticateToken(sign({ ...validClaims(), aud: `${AUDIENCE} https://x.example` }), env),
    ).rejects.toThrow("audience");
  });

  it("caches the signing keys", async () => {
    await authenticateToken(sign(validClaims()), env);
    await authenticateToken(sign(validClaims()), env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the cache expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await authenticateToken(sign(validClaims()), env);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await authenticateToken(sign(validClaims()), env);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches for an unknown kid (a rotated key), at most every 30 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await authenticateToken(sign(validClaims()), env);
    const rotated = keyPair("key-2");
    serveKeys([primary.jwk, rotated.jwk]);

    // Inside the cooldown the cached keys are used, so the new kid is unknown.
    await expect(authenticateToken(sign(validClaims(), rotated), env)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 31 * 1000);
    const user = await authenticateToken(sign(validClaims(), rotated), env);
    expect(user.sub).toBe("auth0|abc");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws JwksUnavailableError when the keys cannot be fetched", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(authenticateToken(sign(validClaims()), env)).rejects.toBeInstanceOf(
      JwksUnavailableError,
    );
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(authenticateToken(sign(validClaims()), env)).rejects.toBeInstanceOf(
      JwksUnavailableError,
    );
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ nokeys: true })));
    await expect(authenticateToken(sign(validClaims()), env)).rejects.toBeInstanceOf(
      JwksUnavailableError,
    );
  });
});

describe("normalizeUser", () => {
  it("returns a RequestUser with all fields trimmed", () => {
    const result = normalizeUser({
      sub: "  auth0|abc  ",
      name: "  Alice  ",
      nickname: "  alice  ",
      email: "  alice@example.com  ",
      permissions: ["access:admin"],
    });

    expect(result.sub).toBe("auth0|abc");
    expect(result.name).toBe("Alice");
    expect(result.nickname).toBe("alice");
    expect(result.email).toBe("alice@example.com");
    expect(result.permissions).toEqual(["access:admin"]);
  });

  it("throws when sub is missing", () => {
    expect(() => normalizeUser({ sub: undefined })).toThrow("Auth0 token missing `sub` claim");
  });

  it("throws when sub is an empty string after trimming", () => {
    expect(() => normalizeUser({ sub: "   " })).toThrow("Auth0 token missing `sub` claim");
  });

  it("returns undefined for empty optional string fields", () => {
    const result = normalizeUser({ sub: "auth0|abc", name: "  ", email: "" });
    expect(result.name).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it("filters non-string values out of the permissions array", () => {
    const result = normalizeUser({
      sub: "auth0|abc",
      permissions: [
        "access:admin",
        42 as unknown as string,
        null as unknown as string,
        "beta:feature",
      ],
    });
    expect(result.permissions).toEqual(["access:admin", "beta:feature"]);
  });

  it("sets permissions to undefined when permissions is not an array", () => {
    const result = normalizeUser({ sub: "auth0|abc", permissions: undefined });
    expect(result.permissions).toBeUndefined();
  });

  it("preserves extra unknown claims via spread", () => {
    const result = normalizeUser({ sub: "auth0|abc", custom_claim: "value" });
    expect((result as Record<string, unknown>).custom_claim).toBe("value");
  });
});
