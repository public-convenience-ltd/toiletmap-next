/**
 * Talks to the local toiletmap-server and mock Auth0 server directly (not via
 * the client's /api proxy) to create fixtures and read back what was saved.
 */
import { AUTH_AUDIENCE, AUTH_URL, RUN_ID, SERVER_URL } from "./env";

export type OpeningTimes = ([string, string] | [])[];

/** Shape of GET /api/loos/:id (see apps/toiletmap-server/src/services/loo/types.ts). */
export type ApiLoo = {
  id: string;
  name: string | null;
  location: { lat: number; lng: number } | null;
  notes: string | null;
  paymentDetails: string | null;
  openingTimes: OpeningTimes | null;
  accessible: boolean | null;
  allGender: boolean | null;
  men: boolean | null;
  women: boolean | null;
  children: boolean | null;
  babyChange: boolean | null;
  radar: boolean | null;
  automatic: boolean | null;
  noPayment: boolean | null;
  updatedAt: string | null;
  [key: string]: unknown;
};

export type LooInput = Partial<Omit<ApiLoo, "id" | "updatedAt">> & {
  name: string;
  location: { lat: number; lng: number };
};

/** Fields that legitimately change on every write and are ignored when diffing records. */
export const VOLATILE_FIELDS = ["updatedAt", "contributorsCount", "reports"] as const;

/**
 * Obtains an API access token from the mock Auth0 server exactly as
 * apps/toiletmap-server/scripts/issue-test-token.ts does: an auto-approved
 * /authorize (default "Test User" profile) followed by the code exchange.
 */
export async function issueAccessToken(): Promise<string> {
  const redirectUri = "http://localhost:9999/callback"; // never visited
  const authorize = new URL(`${AUTH_URL}/authorize`);
  authorize.searchParams.set("client_id", "toiletmap-e2e");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("audience", AUTH_AUDIENCE);
  authorize.searchParams.set("state", "e2e");
  authorize.searchParams.set("nonce", `e2e-${Date.now()}`);
  authorize.searchParams.set("auto", "1");

  const authorizeRes = await fetch(authorize, { redirect: "manual" });
  const location = authorizeRes.headers.get("location");
  const code = location ? new URL(location).searchParams.get("code") : null;
  if (authorizeRes.status !== 302 || !code) {
    throw new Error(`Mock auth /authorize failed (HTTP ${authorizeRes.status}) at ${AUTH_URL}`);
  }

  const tokenRes = await fetch(`${AUTH_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: "toiletmap-e2e",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Mock auth /oauth/token failed (HTTP ${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return access_token;
}

/** How long a server call waits for wrangler to come back after a restart (see log-web-server.ts). */
const SERVER_RESTART_GRACE_MS = 20_000;

/** True when nothing was listening: the request never reached the server, so it is safe to resend. */
const isConnectionRefused = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (code === "ECONNREFUSED") return true;
  if (Array.isArray(errors) && errors.some(isConnectionRefused)) return true;
  return isConnectionRefused(cause);
};

/**
 * `fetch` to the server that rides out a wrangler restart: while the
 * connection is refused it tries again for up to SERVER_RESTART_GRACE_MS.
 * Any other failure (and any HTTP response) is returned or thrown as is.
 */
async function serverFetch(url: string, init?: RequestInit): Promise<Response> {
  const deadline = Date.now() + SERVER_RESTART_GRACE_MS;
  for (;;) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (!isConnectionRefused(error) || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function getLoo(id: string): Promise<ApiLoo> {
  const res = await serverFetch(`${SERVER_URL}/api/loos/${id}`, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`GET /api/loos/${id} failed: HTTP ${res.status}`);
  return (await res.json()) as ApiLoo;
}

export async function createLooViaApi(token: string, input: LooInput): Promise<ApiLoo> {
  const res = await serverFetch(`${SERVER_URL}/api/loos`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (res.status !== 201) {
    throw new Error(`POST /api/loos failed: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ApiLoo;
}

export async function updateLooViaApi(
  token: string,
  id: string,
  changes: Record<string, unknown>,
): Promise<ApiLoo> {
  const res = await serverFetch(`${SERVER_URL}/api/loos/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(`PUT /api/loos/${id} failed: HTTP ${res.status}`);
  return (await res.json()) as ApiLoo;
}

/** A fixture name every e2e row carries (the clean-up sweep matches on the prefix). */
export const e2eName = (label: string): string =>
  `[e2e ${RUN_ID}] ${label} ${Math.random().toString(36).slice(2, 7)}`;

/**
 * A random location in an empty-ish patch of the English Midlands, far from
 * the client's default map view (central London) and from seed rows, so
 * fixture markers never cluster with the ones map.spec looks at.
 */
export const randomFixtureLocation = (): { lat: number; lng: number } => ({
  lat: Number((52.2 + Math.random() * 0.6).toFixed(6)),
  lng: Number((-2.0 + Math.random() * 1.0).toFixed(6)),
});

/** Copy of a record without the fields that change on every write. */
export const stable = (loo: ApiLoo, ...alsoIgnore: string[]): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...loo };
  for (const key of [...VOLATILE_FIELDS, ...alsoIgnore]) delete copy[key];
  return copy;
};
