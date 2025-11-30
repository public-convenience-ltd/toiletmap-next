import type { Env } from "../../types";

type Auth0ManagementClientConfig = {
  issuerBaseUrl: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
  resourceServerIdentifier: string;
  fetchImpl?: typeof fetch;
};

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

export type Auth0ManagementUser = {
  user_id: string;
  email?: string;
  name?: string;
  nickname?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  last_login?: string;
  created_at?: string;
  updated_at?: string;
  logins_count?: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  identities?: Array<{
    provider?: string;
    user_id?: string;
    connection?: string;
    isSocial?: boolean;
  }>;
};

export type Auth0PermissionRecord = {
  id?: string;
  permission_name: string;
  description?: string;
  resource_server_name?: string;
  resource_server_identifier: string;
  sources?: Array<{ source_name: string }>;
};

export class Auth0ManagementError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "Auth0ManagementError";
  }
}

const sanitizeSearchTerm = (term: string) => term.replace(/["']/g, "").replace(/\s+/g, " ").trim();

const buildWildcard = (term: string) => {
  if (!term) return "";
  return term
    .split(" ")
    .filter(Boolean)
    .map((segment) => `*${segment}*`)
    .join(" ");
};

const buildSearchQuery = (term: string) => {
  const sanitized = sanitizeSearchTerm(term);
  if (!sanitized) {
    return "";
  }
  const wildcard = buildWildcard(sanitized);
  const exactId = sanitized.includes("|") ? `user_id:"${sanitized}"` : `user_id:${sanitized}`;
  return [`email:${wildcard}`, `name:${wildcard}`, `nickname:${wildcard}`, exactId].join(" OR ");
};

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

export class Auth0ManagementClient {
  private readonly issuerBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly audience: string;
  private readonly cacheKey: string;
  private readonly resourceServerIdentifier: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: Auth0ManagementClientConfig) {
    if (!config.issuerBaseUrl) {
      throw new Error("Auth0 issuer base URL is required");
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error("Auth0 management client credentials are required");
    }
    if (!config.resourceServerIdentifier) {
      throw new Error("Auth0 resource server identifier is required");
    }

    this.issuerBaseUrl = config.issuerBaseUrl.replace(/\/+$/, "");
    this.apiBaseUrl = `${this.issuerBaseUrl}/api/v2/`;
    this.audience = config.audience ?? `${this.issuerBaseUrl}/api/v2/`;
    this.cacheKey = `${this.issuerBaseUrl}|${config.clientId}`;
    this.resourceServerIdentifier = config.resourceServerIdentifier;
    this.fetchImpl = config.fetchImpl ?? defaultFetch;
  }

  static fromEnv(env: Env): Auth0ManagementClient | null {
    const clientId = env.AUTH0_MANAGEMENT_CLIENT_ID;
    const clientSecret = env.AUTH0_MANAGEMENT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return null;
    }
    return new Auth0ManagementClient({
      issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
      clientId,
      clientSecret,
      audience: env.AUTH0_MANAGEMENT_AUDIENCE,
      resourceServerIdentifier: env.AUTH0_AUDIENCE,
    });
  }

  private resolveUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    const trimmed = path.startsWith("/") ? path.slice(1) : path;
    return new URL(trimmed, this.apiBaseUrl).toString();
  }

  private async request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    const response = await this.fetchImpl(this.resolveUrl(path), {
      ...init,
      headers,
    });
    if (response.status === 401 && retry) {
      await this.getAccessToken(true);
      return this.request(path, init, false);
    }
    if (!response.ok) {
      let details: unknown;
      try {
        details = await response.clone().json();
      } catch {
        details = await response.text();
      }
      throw new Auth0ManagementError(
        `Auth0 Management API request failed with status ${response.status}`,
        response.status,
        details,
      );
    }
    return response;
  }

  private async getAccessToken(force = false): Promise<string> {
    if (!force) {
      const cached = tokenCache.get(this.cacheKey);
      if (cached && cached.expiresAt > Date.now() + 5000) {
        return cached.token;
      }
    }

    const response = await this.fetchImpl(`${this.issuerBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        audience: this.audience,
      }),
    });

    if (!response.ok) {
      let errorDetails: unknown;
      try {
        errorDetails = await response.clone().json();
      } catch {
        errorDetails = await response.text();
      }
      throw new Auth0ManagementError(
        `Failed to obtain Auth0 management token (status ${response.status})`,
        response.status,
        errorDetails,
      );
    }

    const payload: { access_token?: string; expires_in?: number } = await response.json();
    if (!payload.access_token) {
      throw new Auth0ManagementError("Auth0 management token response missing access_token");
    }
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 60;
    tokenCache.set(this.cacheKey, {
      token: payload.access_token,
      expiresAt: Date.now() + Math.max(expiresIn - 30, 30) * 1000,
    });
    return payload.access_token;
  }

  async searchUsers(term: string, limit = 5): Promise<Auth0ManagementUser[]> {
    const normalized = sanitizeSearchTerm(term);
    if (!normalized) {
      return [];
    }
    const query = buildSearchQuery(normalized);
    if (!query) {
      return [];
    }
    const params = new URLSearchParams({
      q: query,
      search_engine: "v3",
      per_page: String(Math.max(1, Math.min(limit, 25))),
      page: "0",
      include_totals: "false",
    });
    const response = await this.request(`users?${params.toString()}`, {
      method: "GET",
    });
    const results = (await response.json()) as Auth0ManagementUser[];
    return Array.isArray(results) ? results : [];
  }

  async getUser(userId: string): Promise<Auth0ManagementUser | null> {
    if (!userId) {
      return null;
    }
    try {
      const response = await this.request(`users/${encodeURIComponent(userId)}`, { method: "GET" });
      return (await response.json()) as Auth0ManagementUser;
    } catch (error) {
      if (error instanceof Auth0ManagementError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getUserPermissions(userId: string): Promise<Auth0PermissionRecord[]> {
    if (!userId) {
      return [];
    }
    const response = await this.request(`users/${encodeURIComponent(userId)}/permissions`, {
      method: "GET",
    });
    const results = (await response.json()) as Auth0PermissionRecord[];
    return Array.isArray(results) ? results : [];
  }

  async addPermissions(userId: string, permissions: string[]): Promise<void> {
    const payload = permissions
      .filter((permission) => typeof permission === "string" && permission.trim())
      .map((permission_name) => ({
        permission_name,
        resource_server_identifier: this.resourceServerIdentifier,
      }));
    if (!payload.length) {
      return;
    }
    await this.request(`users/${encodeURIComponent(userId)}/permissions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ permissions: payload }),
    });
  }

  async removePermissions(userId: string, permissions: string[]): Promise<void> {
    const payload = permissions
      .filter((permission) => typeof permission === "string" && permission.trim())
      .map((permission_name) => ({
        permission_name,
        resource_server_identifier: this.resourceServerIdentifier,
      }));
    if (!payload.length) {
      return;
    }
    await this.request(`users/${encodeURIComponent(userId)}/permissions`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ permissions: payload }),
    });
  }
}

export const hasAuth0ManagementConfig = (env: Env): boolean =>
  Boolean(env.AUTH0_MANAGEMENT_CLIENT_ID && env.AUTH0_MANAGEMENT_CLIENT_SECRET);
