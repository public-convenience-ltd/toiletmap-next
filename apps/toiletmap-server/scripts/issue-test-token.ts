#!/usr/bin/env tsx
import { parseArgs } from "node:util";

const AUTH_SERVER_URL = "http://127.0.0.1:44555";

/**
 * Generates a test JWT token for local development.
 *
 * IMPORTANT: This requires the auth server to be running on port 44555.
 * Start it with: pnpm dev (default) or pnpm auth:server
 *
 * Usage:
 *   pnpm token:issue
 *   pnpm token:issue --name="Jane Doe" --email="jane@example.com"
 *   pnpm token:issue --admin
 *
 * The token can be used with the Authorization header:
 *   curl -H "Authorization: Bearer <token>" http://localhost:8787/api/loos
 */
async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string", default: "Local Developer" },
      email: { type: "string", default: "dev@localhost" },
      nickname: { type: "string", default: "dev" },
      admin: { type: "boolean", default: false },
      sub: { type: "string", default: "auth0|local-dev-user" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
🎫 Test Token Generator

IMPORTANT: The auth server must be running on port 44555.
Start it with: pnpm dev (Wrangler + auth) or pnpm auth:server

Usage:
  pnpm token:issue [options]

Options:
  --name <string>      User's full name (default: "Local Developer")
  --email <string>     User's email (default: "dev@localhost")
  --nickname <string>  User's nickname (default: "dev")
  --sub <string>       User's subject ID (default: "auth0|local-dev-user")
  --admin              Include admin permissions
  -h, --help           Show this help message

Examples:
  pnpm token:issue
  pnpm token:issue --name="Jane Doe" --email="jane@example.com"
  pnpm token:issue --admin
  pnpm token:issue --name="Admin User" --admin

Use the token with curl:
  TOKEN=$(pnpm token:issue)
  curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/loos/search
`);
    process.exit(0);
  }

  // Check if auth server is running
  try {
    const testResponse = await fetch(`${AUTH_SERVER_URL}/.well-known/jwks.json`);
    if (!testResponse.ok) {
      throw new Error("Auth server not responding");
    }
  } catch (_error) {
    console.error(`
❌ Error: Auth server is not running on ${AUTH_SERVER_URL}

Please start the auth server first:
  pnpm dev          # Full dev stack (incl. auth server)
  # or
  pnpm auth:server  # Auth server only
`);
    process.exit(1);
  }

  // Build OAuth2 authorize URL with auto-login
  const audience = process.env.AUTH0_AUDIENCE || "https://toiletmap.org.uk";
  const state = "cli-token-generator";
  const nonce = `cli-nonce-${Date.now()}`;
  const redirectUri = "http://localhost:9999/callback"; // Dummy callback

  const authorizeUrl = new URL(`${AUTH_SERVER_URL}/authorize`);
  authorizeUrl.searchParams.set("client_id", "test_client_id");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid profile email");
  authorizeUrl.searchParams.set("audience", audience);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("auto", "1");

  // Follow redirect to get authorization code
  const authorizeResponse = await fetch(authorizeUrl.toString(), {
    redirect: "manual",
  });

  if (authorizeResponse.status !== 302) {
    console.error("❌ Failed to get authorization code from auth server");
    process.exit(1);
  }

  const location = authorizeResponse.headers.get("location");
  if (!location) {
    console.error("❌ No redirect location from auth server");
    process.exit(1);
  }

  const callbackUrl = new URL(location);
  const code = callbackUrl.searchParams.get("code");

  if (!code) {
    console.error("❌ No authorization code in callback");
    process.exit(1);
  }

  // Exchange code for token
  const tokenResponse = await fetch(`${AUTH_SERVER_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: "test_client_id",
      client_secret: "test_client_secret",
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    console.error("❌ Failed to exchange code for token");
    process.exit(1);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    id_token: string;
  };

  // Output the access token (which has the permissions and can be used for API calls)
  console.log(tokenData.access_token);
}

main().catch((error) => {
  console.error("❌ Failed to generate token:", error);
  process.exit(1);
});
