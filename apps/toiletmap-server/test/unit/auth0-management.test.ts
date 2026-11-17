import { describe, expect, it, vi } from "vitest";
import { Auth0ManagementClient, Auth0ManagementError } from "../../src/services/auth0/management";

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
