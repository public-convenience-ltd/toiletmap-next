import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createApp } from "../../src/app";
import { Env } from "../../src/types";
import { getTestContext } from "../integration/setup";
import * as prismaModule from "../../src/prisma";
import {
  ContributorStats,
  UserInsightsService,
} from "../../src/services/contributor";
import { Auth0ManagementClient } from "../../src/services/auth0/management";
import {
  ADMIN_ROLE_ID,
  __adminRoleTestUtils,
} from "../../src/middleware/require-admin-role";
import { LooService } from "../../src/services/loo";
import type { LooResponse, ReportResponse } from "../../src/services/loo/types";
import type { OpeningTimes } from "../../src/services/loo/types";

const buildEnv = (): Env => ({
  TEST_HYPERDRIVE: {
    connectionString:
      process.env
        .CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE ??
      "postgresql://postgres:postgres@localhost:54322/postgres",
  },
  HYPERDRIVE: {
    connectionString:
      process.env
        .CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE ??
      "postgresql://postgres:postgres@localhost:54322/postgres",
  },
  AUTH0_ISSUER_BASE_URL:
    process.env.AUTH0_ISSUER_BASE_URL ?? "https://example.auth0.com/",
  AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE ?? "https://api.toiletmap.org.uk",
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID ?? "test-client-id",
  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET ?? "test-client-secret",
  AUTH0_SCOPE: process.env.AUTH0_SCOPE ?? "openid profile email",
  AUTH0_REDIRECT_URI:
    process.env.AUTH0_REDIRECT_URI ?? "http://localhost:8787/admin/callback",
  AUTH0_MANAGEMENT_CLIENT_ID:
    process.env.AUTH0_MANAGEMENT_CLIENT_ID ??
    `test-management-client-${randomUUID()}`,
  AUTH0_MANAGEMENT_CLIENT_SECRET:
    process.env.AUTH0_MANAGEMENT_CLIENT_SECRET ?? "test-management-secret",
  RATE_LIMIT_READ: { limit: vi.fn().mockResolvedValue({ success: true }) },
  RATE_LIMIT_WRITE: { limit: vi.fn().mockResolvedValue({ success: true }) },
  RATE_LIMIT_ADMIN: { limit: vi.fn().mockResolvedValue({ success: true }) },
  RATE_LIMIT_AUTH: { limit: vi.fn().mockResolvedValue({ success: true }) },
});

let env: Env;
let app: ReturnType<typeof createApp>;
let mockGetUserPermissions: ReturnType<typeof vi.fn>;

type SessionOptions = {
  permissions?: string[] | null;
  sub?: string;
};

const buildSessionCookie = (
  options?: SessionOptions,
  activeEnv: Env | undefined = env
) => {
  if (!activeEnv) {
    throw new Error("Test env is not initialised");
  }
  const { issueToken } = getTestContext();
  const hasCustomPermissions = options
    ? Object.prototype.hasOwnProperty.call(options, "permissions")
    : false;
  const permissions = hasCustomPermissions
    ? options?.permissions ?? null
    : [ADMIN_ROLE_ID];
  const sub = options?.sub ?? "auth0|test-user";
  const claims: Record<string, unknown> = { sub };
  if (permissions !== null) {
    claims.permissions = permissions;
  }
  const accessToken = issueToken(claims);
  const idToken = issueToken({ ...claims, aud: activeEnv.AUTH0_CLIENT_ID });

  const user = {
    sub,
    email: "admin@example.com",
    name: "Test Admin",
    nickname: "Testy",
  };

  const encodedUser = Buffer.from(JSON.stringify(user)).toString("base64");
  return `id_token=${idToken}; access_token=${accessToken}; user_info=${encodedUser}`;
};

const authenticatedHeaders = (options?: SessionOptions, customEnv?: Env) => ({
  Cookie: buildSessionCookie(options, customEnv ?? env),
});

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const resolveUrl = (input: Parameters<typeof fetch>[0]) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  if (typeof input === "object" && input && "url" in input) {
    return (input as Request).url;
  }
  return String(input);
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractJsonConfig = <T>(html: string, scriptId: string): T => {
  const pattern = new RegExp(
    `<script[^>]*id="${escapeRegExp(scriptId)}"[^>]*>([\\s\\S]*?)</script>`
  );
  const match = pattern.exec(html);
  if (!match) {
    throw new Error(`Script with id "${scriptId}" not found`);
  }
  const payload = match[1].trim();
  if (!payload) {
    throw new Error(`Script with id "${scriptId}" is empty`);
  }
  return JSON.parse(payload) as T;
};

const mockApiResponses = () => {
  const searchResponse = {
    data: [
      {
        id: "loo_123",
        name: "Test Loo",
        area: [{ name: "Test Borough" }],
        geohash: "gcpvj0",
        active: true,
        verifiedAt: new Date().toISOString(),
        accessible: true,
        babyChange: false,
        noPayment: true,
        radar: false,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        contributorsCount: 2,
        openingTimes: null,
      },
    ],
    count: 1,
    total: 1,
    page: 1,
    pageSize: 25,
    hasMore: false,
  };

  const metricsResponse = {
    recentWindowDays: 30,
    totals: {
      filtered: 1,
      active: 1,
      verified: 1,
      accessible: 1,
      babyChange: 0,
      radar: 0,
      freeAccess: 1,
      recent: 1,
    },
    areas: [{ areaId: "area_1", name: "Test Borough", count: 1 }],
  };

  // Store original fetch to pass through JWKS requests
  const originalFetch = globalThis.fetch;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init?) => {
    const url = resolveUrl(input);

    // Pass through JWKS requests to the test auth server
    if (url.includes("/.well-known/jwks.json")) {
      return originalFetch(input, init);
    }

    if (url.includes("/api/loos/search")) {
      return jsonResponse(searchResponse);
    }
    if (url.includes("/api/loos/metrics")) {
      return jsonResponse(metricsResponse);
    }
    return jsonResponse({ message: "Not found" }, 404);
  });
};

beforeEach(() => {
  __adminRoleTestUtils.clearPermissionCache();
  __adminRoleTestUtils.clearManagementClientCache();
  env = buildEnv();
  mockGetUserPermissions = vi.fn().mockResolvedValue([
    {
      permission_name: ADMIN_ROLE_ID,
      resource_server_identifier: env.AUTH0_AUDIENCE,
    },
  ]);
  vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue({
    getUserPermissions: mockGetUserPermissions,
  } as unknown as Auth0ManagementClient);
  app = createApp(env);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Admin Routes", () => {
  it("should redirect to Auth0 login page when accessing /admin/login", async () => {
    const res = await app.request("/admin/login", {}, env);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain(env.AUTH0_ISSUER_BASE_URL);
    expect(location).toContain(
      `client_id=${encodeURIComponent(env.AUTH0_CLIENT_ID)}`
    );
    expect(location).toContain(
      `redirect_uri=${encodeURIComponent(env.AUTH0_REDIRECT_URI)}`
    );
  });

  it("should render dataset explorer at /admin when session cookies are present", async () => {
    const res = await app.request(
      "/admin",
      { headers: authenticatedHeaders() },
      env
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Dataset Explorer");
    expect(text).toContain("Add New Loo");
  });

  it("should show an access denied page when the user is authenticated without admin role", async () => {
    const res = await app.request(
      "/admin",
      { headers: authenticatedHeaders({ permissions: [] }) },
      env
    );
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("Admin access required");
    expect(text).toContain("Switch account");
  });

  it("should clear the session if Auth0 revokes the admin permission mid-session", async () => {
    const revokedSub = "auth0|revoked-admin";
    mockGetUserPermissions.mockResolvedValueOnce([]);

    const res = await app.request(
      "/admin",
      { headers: authenticatedHeaders({ sub: revokedSub }) },
      env
    );

    expect(mockGetUserPermissions).toHaveBeenCalledWith(revokedSub);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("Admin access required");

    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();
    expect(setCookieHeader).toContain("id_token=");
    expect(setCookieHeader?.toLowerCase()).toContain("max-age=0");
  });

  it("should render loos list at /admin/loos when session cookies are present", async () => {
    mockApiResponses();
    const res = await app.request(
      "/admin/loos",
      { headers: authenticatedHeaders() },
      env
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Loos");
    expect(text).toContain("Add New Loo");
  });

  it("should render loo detail page using shared API handlers", async () => {
    const now = new Date().toISOString();
    const mockLoo: LooResponse = {
      id: "1e1a6eb93a725687459ff4cf",
      name: "Central Park Loo",
      area: [{ name: "Central Borough", type: "district" }],
      createdAt: now,
      updatedAt: now,
      verifiedAt: null,
      reports: [],
      contributorsCount: 1,
      geohash: "gcpvj0",
      accessible: true,
      active: true,
      allGender: null,
      attended: null,
      automatic: null,
      babyChange: null,
      children: null,
      men: null,
      women: null,
      urinalOnly: null,
      notes: null,
      noPayment: true,
      paymentDetails: null,
      removalReason: null,
      radar: null,
      openingTimes: null,
      location: { lat: 51.5, lng: -0.12 },
    };
    const mockReports: ReportResponse[] = [
      {
        id: "rep_1",
        contributor: "Testy",
        createdAt: now,
        verifiedAt: null,
        diff: null,
        geohash: null,
        accessible: null,
        active: null,
        allGender: null,
        attended: null,
        automatic: null,
        babyChange: null,
        children: null,
        men: null,
        women: null,
        urinalOnly: null,
        notes: null,
        noPayment: null,
        paymentDetails: null,
        removalReason: null,
        radar: null,
        openingTimes: null,
        location: null,
      },
    ];

    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue({} as any);
    const getById = vi
      .spyOn(LooService.prototype, "getById")
      .mockResolvedValue(mockLoo);
    const getReports = vi
      .spyOn(LooService.prototype, "getReports")
      .mockResolvedValue(mockReports);

    const res = await app.request(
      `/admin/loos/${mockLoo.id}`,
      { headers: authenticatedHeaders() },
      env
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Loo details");
    expect(text).toContain(mockLoo.name!);
    expect(getById).toHaveBeenCalledWith(mockLoo.id);
    expect(getReports).toHaveBeenCalled();
  });

  it("should embed persisted values into the edit form config", async () => {
    const now = new Date().toISOString();
    const openingTimes: OpeningTimes = [
      ["08:00", "18:00"],
      ["08:00", "18:00"],
      [] as [],
      [] as [],
      ["09:00", "17:00"],
      ["10:00", "16:00"],
      ["00:00", "00:00"],
    ];
    const mockLoo: LooResponse = {
      id: "edit_loo_123",
      name: "Edit Target",
      area: [{ name: "Central Borough", type: "district" }],
      createdAt: now,
      updatedAt: now,
      verifiedAt: null,
      reports: [],
      contributorsCount: 2,
      geohash: "gcpvj0",
      accessible: true,
      active: true,
      allGender: null,
      attended: false,
      automatic: null,
      babyChange: null,
      children: null,
      men: true,
      women: false,
      urinalOnly: null,
      notes: "Existing notes",
      noPayment: true,
      paymentDetails: "Card only",
      removalReason: null,
      radar: false,
      openingTimes,
      location: { lat: 51.501, lng: -0.141 },
    };

    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue({} as any);
    const getById = vi
      .spyOn(LooService.prototype, "getById")
      .mockResolvedValue(mockLoo);

    const res = await app.request(
      `/admin/loos/${mockLoo.id}/edit`,
      { headers: authenticatedHeaders() },
      env
    );
    expect(res.status).toBe(200);
    expect(getById).toHaveBeenCalledWith(mockLoo.id);

    const text = await res.text();
    const config = extractJsonConfig<{
      defaults: Record<string, unknown>;
      api: { update: string };
      looId: string;
    }>(text, "loo-edit-config");

    expect(config.looId).toBe(mockLoo.id);
    expect(config.api.update).toBe(`/api/loos/${mockLoo.id}`);
    expect(config.defaults.openingTimes).toEqual(openingTimes);
    expect(config.defaults.lat).toBe(mockLoo.location!.lat.toString());
    expect(config.defaults.lng).toBe(mockLoo.location!.lng.toString());
    expect(config.defaults.name).toBe(mockLoo.name);
    expect(config.defaults.noPayment).toBe("true");
    expect(config.defaults.women).toBe("false");
  });

  it("should render a helpful state when trying to edit a missing loo", async () => {
    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue({} as any);
    const getById = vi
      .spyOn(LooService.prototype, "getById")
      .mockResolvedValue(null);

    const res = await app.request(
      "/admin/loos/missing/edit",
      { headers: authenticatedHeaders() },
      env
    );
    expect(res.status).toBe(200);
    expect(getById).toHaveBeenCalledWith("missing");
    const text = await res.text();
    expect(text).toContain("Loo not found");
    expect(text).toContain("Back to dataset");
  });

  it("should redirect to home when hitting /admin/logout", async () => {
    const res = await app.request(
      "/admin/logout",
      { headers: authenticatedHeaders() },
      env
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toBe("/");
  });

  it("should render user statistics at /admin/users/statistics when session cookies are present", async () => {
    const now = new Date().toISOString();
    const stats: ContributorStats = {
      summary: {
        handle: "Testy",
        totalLoos: 2,
        activeLoos: 1,
        verifiedLoos: 1,
        recentLoos: 1,
        totalEvents: 3,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      areas: [{ areaId: "area_1", name: "Test Borough", count: 2 }],
      loos: [
        {
          id: "loo_123",
          name: "Test Loo",
          updatedAt: now,
          verifiedAt: null,
          areaName: "Test Borough",
          areaType: "district",
        },
      ],
      recentReports: [
        {
          id: "report_1",
          contributor: "Testy",
          createdAt: now,
          verifiedAt: null,
          diff: {
            notes: { previous: "old", current: "new" },
          },
          geohash: null,
          accessible: null,
          active: null,
          allGender: null,
          attended: null,
          automatic: null,
          babyChange: null,
          children: null,
          men: null,
          women: null,
          urinalOnly: null,
          notes: null,
          noPayment: null,
          paymentDetails: null,
          removalReason: null,
          radar: null,
          openingTimes: null,
          location: null,
          looId: "loo_123",
          looName: "Test Loo",
          occurredAt: now,
        },
      ],
    };

    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue({} as any);
    vi.spyOn(
      UserInsightsService.prototype,
      "getPopularContributors"
    ).mockResolvedValue([{ handle: "Testy", contributions: 3 }]);
    vi.spyOn(
      UserInsightsService.prototype,
      "getContributorStats"
    ).mockResolvedValue(stats);

    const res = await app.request(
      "/admin/users/statistics",
      { headers: authenticatedHeaders() },
      env
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("User statistics");
    expect(text).toContain("Testy");
    expect(
      UserInsightsService.prototype.getContributorStats
    ).toHaveBeenCalled();
  });

  it("should render the user administration page even when management credentials are missing", async () => {
    const envWithoutMgmt: Env = {
      ...env,
      AUTH0_MANAGEMENT_CLIENT_ID: "",
      AUTH0_MANAGEMENT_CLIENT_SECRET: "",
    };
    __adminRoleTestUtils.clearManagementClientCache();
    vi.mocked(Auth0ManagementClient.fromEnv).mockReturnValue(
      null as unknown as Auth0ManagementClient
    );
    const appWithoutMgmt = createApp(envWithoutMgmt);
    const res = await appWithoutMgmt.request(
      "/admin/users/admin",
      { headers: authenticatedHeaders(undefined, envWithoutMgmt) },
      envWithoutMgmt
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("User administration");
    expect(text).toContain("Auth0 management disabled");
  });

  it("should grant permissions via the Auth0 management client", async () => {
    const addPermissions = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      addPermissions,
      removePermissions: vi.fn(),
    };
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
      mockClient as unknown as Auth0ManagementClient
    );

    const body = new URLSearchParams({
      user_id: "auth0|user123",
      permission: "access:admin",
      intent: "grant",
      redirect_to: "/admin/users/admin?user=auth0%7Cuser123",
    }).toString();

    const res = await app.request(
      "/admin/users/admin/permissions",
      {
        method: "POST",
        headers: {
          ...authenticatedHeaders(),
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
      env
    );

    expect(res.status).toBe(303);
    expect(addPermissions).toHaveBeenCalledWith("auth0|user123", [
      "access:admin",
    ]);
  });

  it("should revoke permissions via the Auth0 management client", async () => {
    const removePermissions = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      addPermissions: vi.fn(),
      removePermissions,
    };
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
      mockClient as unknown as Auth0ManagementClient
    );

    const body = new URLSearchParams({
      user_id: "auth0|user456",
      permission: "report:loo",
      intent: "revoke",
      redirect_to: "/admin/users/admin?user=auth0%7Cuser456",
    }).toString();

    const res = await app.request(
      "/admin/users/admin/permissions",
      {
        method: "POST",
        headers: {
          ...authenticatedHeaders(),
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
      env
    );

    expect(res.status).toBe(303);
    expect(removePermissions).toHaveBeenCalledWith("auth0|user456", [
      "report:loo",
    ]);
  });
});
