import { describe, expect, it } from "vitest";
import { decode } from "hono/jwt";
import { startAuthServer } from "./auth-server";

const audience = "https://example.test/api";
const clientId = "custom-client";
const redirectUri = "http://localhost/callback";

describe("local auth server customization", () => {
  it("applies custom form values to tokens and userinfo", async () => {
    const server = await startAuthServer({ audience });
    try {
      const authorizeUrl = new URL("authorize", server.issuer).toString();
      const form = new URLSearchParams();
      form.set("client_id", clientId);
      form.set("redirect_uri", redirectUri);
      form.set("state", "STATE123");
      form.set("nonce", "NONCE123");
      form.set("scope", "openid email offline_access");
      form.set("audience", audience);
      form.set("user_name", "Custom Dev");
      form.set("user_email", "dev@example.com");
      form.set("user_nickname", "cdev");
      form.set("user_sub", "auth0|custom-dev");
      form.set("contributor_name", "Custom Contributor");
      form.set("extra_permissions", "beta:feature,ops:read");
      form.append("permissions", "report:loo");
      form.append("permissions", "access:admin");
      form.set("custom_claims", JSON.stringify({
        "https://claims.example/roles": ["editor"],
      }));

      const authorizeResponse = await fetch(authorizeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        redirect: "manual",
      });

      expect(authorizeResponse.status).toBe(302);
      const location = authorizeResponse.headers.get("location");
      expect(location).toBeTruthy();
      const code = new URL(location!).searchParams.get("code");
      expect(code).toBeTruthy();

      const tokenResponse = await fetch(new URL("oauth/token", server.issuer), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: "not-required",
          redirect_uri: redirectUri,
          code,
        }),
      });

      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json() as {
        access_token: string;
        id_token: string;
      };

      const decodedAccess = decode(tokens.access_token).payload as Record<string, unknown>;
      expect(decodedAccess?.name).toBe("Custom Dev");
      expect(decodedAccess?.email).toBe("dev@example.com");
      expect(decodedAccess?.permissions).toEqual(
        expect.arrayContaining(["access:admin", "report:loo", "beta:feature", "ops:read"]),
      );
      expect(decodedAccess?.app_metadata).toMatchObject({ contributor_name: "Custom Contributor" });

      const userInfoResponse = await fetch(new URL("userinfo", server.issuer), {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      expect(userInfoResponse.status).toBe(200);
      const userInfo = await userInfoResponse.json();
      expect(userInfo.email).toBe("dev@example.com");
      expect(userInfo.permissions).toEqual(
        expect.arrayContaining(["access:admin", "report:loo", "beta:feature", "ops:read"]),
      );
      expect(userInfo["https://claims.example/roles"]).toEqual(["editor"]);
    } finally {
      await server.stop();
    }
  });
});
