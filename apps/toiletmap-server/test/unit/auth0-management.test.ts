import { describe, expect, it, vi } from "vitest";
import {
  Auth0ManagementClient,
  Auth0ManagementError,
  buildSearchQuery,
} from "../../src/services/auth0/management";

/** A client whose Management API answers `GET /users/:id` with `user` (or `status`). */
const clientAnswering = (user: unknown, status = 200) => {
  const fetchImpl = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(
      String(input).endsWith("/oauth/token")
        ? Response.json({ access_token: "management-token", expires_in: 3600 })
        : Response.json(user, { status }),
    ),
  );
  const client = new Auth0ManagementClient({
    // A unique issuer per client keeps the module's token cache out of the way.
    issuerBaseUrl: `https://auth-${crypto.randomUUID()}.example`,
    clientId: "management-client",
    clientSecret: "secret",
    resourceServerIdentifier: "https://api.example",
    fetchImpl,
  });
  return { client, fetchImpl };
};

describe("Auth0ManagementClient.isUserBlocked", () => {
  it("requests only the blocked field for that user", async () => {
    const { client, fetchImpl } = clientAnswering({ blocked: true });
    expect(await client.isUserBlocked("auth0|abc")).toBe(true);

    const url = new URL(String(fetchImpl.mock.calls.at(-1)?.[0]));
    expect(url.pathname).toBe("/api/v2/users/auth0%7Cabc");
    expect(url.searchParams.get("fields")).toBe("blocked");
    expect(url.searchParams.get("include_fields")).toBe("true");
  });

  it("is false when Auth0 omits blocked or reports it false", async () => {
    expect(await clientAnswering({}).client.isUserBlocked("auth0|a")).toBe(false);
    expect(await clientAnswering({ blocked: false }).client.isUserBlocked("auth0|b")).toBe(false);
  });

  it("throws rather than guessing when the lookup fails", async () => {
    await expect(
      clientAnswering({ message: "Not found" }, 404).client.isUserBlocked("auth0|gone"),
    ).rejects.toBeInstanceOf(Auth0ManagementError);
    await expect(clientAnswering({}).client.isUserBlocked("")).rejects.toThrow();
  });
});

describe("buildSearchQuery (Auth0 user search)", () => {
  it("matches plain text by wildcard and the user_id exactly", () => {
    expect(buildSearchQuery("  jane   doe ")).toBe(
      'email:(*jane* *doe*) OR name:(*jane* *doe*) OR nickname:(*jane* *doe*) OR user_id:"jane doe"',
    );
    expect(buildSearchQuery("auth0|abc")).toBe(
      'email:(*auth0\\|abc*) OR name:(*auth0\\|abc*) OR nickname:(*auth0\\|abc*) OR user_id:"auth0|abc"',
    );
  });

  it("escapes query syntax so admin text can only be matched, never parsed", () => {
    const query = buildSearchQuery('x) OR app_metadata.role:admin OR (y "a\\b" <z>');
    // Field names, groups and quotes from the text arrive escaped.
    expect(query).toContain("*app_metadata.role\\:admin*");
    expect(query).toContain("*x\\)*");
    expect(query).toContain("*\\(y*");
    expect(query).toContain('*\\"a\\\\b\\"*');
    const [wildcards, exactId] = query.split(" OR user_id:");
    // `<` and `>` cannot be escaped in a bare term, so they are dropped there.
    expect(wildcards).not.toMatch(/[<>]/);
    // No unescaped `:` other than the three field prefixes.
    expect(wildcards.match(/(?<!\\):/g)).toHaveLength(3);
    // Inside the quoted phrase only `"` and `\` need escaping.
    expect(exactId).toBe('"x) OR app_metadata.role:admin OR (y \\"a\\\\b\\" <z>"');
  });

  it("is empty for blank text and falls back to user_id when nothing searchable is left", () => {
    expect(buildSearchQuery("   ")).toBe("");
    expect(buildSearchQuery("<>")).toBe('user_id:"<>"');
    expect(buildSearchQuery("a\u0000b\nc")).toBe(
      'email:(*a* *b* *c*) OR name:(*a* *b* *c*) OR nickname:(*a* *b* *c*) OR user_id:"a b c"',
    );
  });
});
