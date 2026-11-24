import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { __adminRoleTestUtils, ADMIN_ROLE_ID } from "../../src/middleware/require-admin-role";
import * as prismaModule from "../../src/prisma";
import { Auth0ManagementClient } from "../../src/services/auth0/management";
import { type ContributorStats, UserInsightsService } from "../../src/services/contributor";
import { LooService } from "../../src/services/loo";
import type { LooResponse, OpeningTimes, ReportResponse } from "../../src/services/loo/types";
import type { Env } from "../../src/types";
import { getTestContext } from "../integration/setup";
import { createTestHyperdrive } from "../integration/utils/env";

const buildEnv = (): Env => ({
  TEST_HYPERDRIVE: createTestHyperdrive(),
  HYPERDRIVE: createTestHyperdrive(),
  AUTH0_ISSUER_BASE_URL: process.env.AUTH0_ISSUER_BASE_URL ?? "https://example.auth0.com/",
  AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE ?? "https://api.toiletmap.org.uk",
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID ?? "test-client-id",
  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET ?? "test-client-secret",
  AUTH0_SCOPE: process.env.AUTH0_SCOPE ?? "openid profile email",
  AUTH0_REDIRECT_URI: process.env.AUTH0_REDIRECT_URI ?? "http://localhost:8787/admin/callback",
  AUTH0_MANAGEMENT_CLIENT_ID:
    process.env.AUTH0_MANAGEMENT_CLIENT_ID ?? `test-management-client-${randomUUID()}`,
  AUTH0_MANAGEMENT_CLIENT_SECRET:
    process.env.AUTH0_MANAGEMENT_CLIENT_SECRET ?? "test-management-secret",
  RATE_LIMIT_READ: { limit: vi.fn().mockResolvedValue({ success: true }) },
  RATE_LIMIT_WRITE: { limit: vi.fn().mockResolvedValue({ success: true }) },
  RATE_LIMIT_ADMIN: { limit: vi.fn().mockResolvedValue({ success: true }) },
  RATE_LIMIT_AUTH: { limit: vi.fn().mockResolvedValue({ success: true }) },
  RATE_LIMIT_ANON_WRITE: { limit: vi.fn().mockResolvedValue({ success: true }) },
});

/**
 * Stands in for the Prisma client in tests that mock every service call.
 * It has no models, so an unmocked query fails loudly instead of hitting the database.
 */
const stubPrismaClient = {} as prismaModule.PrismaClientInstance;

let env: Env;
let app: ReturnType<typeof createApp>;
let mockGetUserPermissions: ReturnType<typeof vi.fn>;
let mockIsUserBlocked: ReturnType<typeof vi.fn>;

type SessionOptions = {
  permissions?: string[] | null;
  sub?: string;
};

const buildSessionCookie = (options?: SessionOptions, activeEnv: Env | undefined = env) => {
  if (!activeEnv) {
    throw new Error("Test env is not initialised");
  }
  const { issueToken } = getTestContext();
  const hasCustomPermissions = options ? Object.hasOwn(options, "permissions") : false;
  const permissions = hasCustomPermissions ? (options?.permissions ?? null) : [ADMIN_ROLE_ID];
  const sub = options?.sub ?? "auth0|test-user";
  const claims: Record<string, unknown> = { sub };
  if (permissions !== null) {
    claims.permissions = permissions;
  }
  const accessToken = issueToken(claims);
  // The profile (name, email) comes from the verified id_token.
  const idToken = issueToken({
    ...claims,
    aud: activeEnv.AUTH0_CLIENT_ID,
    email: "admin@example.com",
    name: "Test Admin",
    nickname: "Testy",
  });

  return `id_token=${idToken}; access_token=${accessToken}`;
};

/** `app.request("/admin/...")` resolves against this origin. */
const ADMIN_ORIGIN = "http://localhost";

/**
 * Session cookies plus a same-origin `Origin`, as a browser sends on the
 * admin's own form posts (cookie-authenticated POSTs need it).
 */
const authenticatedHeaders = (options?: SessionOptions, customEnv?: Env) => ({
  Cookie: buildSessionCookie(options, customEnv ?? env),
  Origin: ADMIN_ORIGIN,
});

/**
 * A stand-in Auth0 Management client: the signed-in admin keeps access:admin
 * (`mockGetUserPermissions`) and nobody is blocked, plus `extra` methods.
 */
const managementClientMock = (extra: Record<string, unknown> = {}) =>
  ({
    getUserPermissions: mockGetUserPermissions,
    isUserBlocked: mockIsUserBlocked,
    ...extra,
  }) as unknown as Auth0ManagementClient;

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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractJsonConfig = <T>(html: string, scriptId: string): T => {
  const pattern = new RegExp(
    `<script[^>]*id="${escapeRegExp(scriptId)}"[^>]*>([\\s\\S]*?)</script>`,
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

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init?) => {
    const url = resolveUrl(input);

    // Pass through JWKS requests to the test auth server
    if (url.includes("/.well-known/jwks.json")) {
      return originalFetch(input, init);
    }

    if (url.includes("/api/loos/search")) {
      return Promise.resolve(jsonResponse(searchResponse));
    }
    if (url.includes("/api/loos/metrics")) {
      return Promise.resolve(jsonResponse(metricsResponse));
    }
    return Promise.resolve(jsonResponse({ message: "Not found" }, 404));
  });
};

beforeEach(() => {
  __adminRoleTestUtils.clearPermissionCache();
  __adminRoleTestUtils.clearBlockedCache();
  __adminRoleTestUtils.clearManagementClientCache();
  env = buildEnv();
  mockGetUserPermissions = vi.fn().mockResolvedValue([
    {
      permission_name: ADMIN_ROLE_ID,
      resource_server_identifier: env.AUTH0_AUDIENCE,
    },
  ]);
  mockIsUserBlocked = vi.fn().mockResolvedValue(false);
  vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(managementClientMock());
  app = createApp(env);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Admin Routes", () => {
  it("should redirect to Auth0 login page when accessing /admin/login", async () => {
    const previewOrigin = "https://preview-123-toiletmap-server.gbtoiletmap.workers.dev";
    const res = await app.request(`${previewOrigin}/admin/login`, {}, env);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toBeTruthy();
    const redirectLocation = new URL(location as string);
    expect(redirectLocation.origin).toBe(new URL(env.AUTH0_ISSUER_BASE_URL).origin);
    expect(redirectLocation.searchParams.get("client_id")).toBe(env.AUTH0_CLIENT_ID);
    expect(redirectLocation.searchParams.get("redirect_uri")).toBe(
      `${previewOrigin}/admin/callback`,
    );
  });

  it("should render dataset explorer at /admin when session cookies are present", async () => {
    const res = await app.request("/admin", { headers: authenticatedHeaders() }, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Dataset Explorer");
    expect(text).toContain("Add New Loo");
  });

  it("should show an access denied page when the user is authenticated without admin role", async () => {
    const res = await app.request(
      "/admin",
      { headers: authenticatedHeaders({ permissions: [] }) },
      env,
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
      env,
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
    const res = await app.request("/admin/loos", { headers: authenticatedHeaders() }, env);
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
      removalCategory: null,
      duplicateOf: null,
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
        removalCategory: null,
        duplicateOf: null,
        radar: null,
        openingTimes: null,
        location: null,
      },
    ];

    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue(stubPrismaClient);
    const getById = vi.spyOn(LooService.prototype, "getById").mockResolvedValue(mockLoo);
    const getReports = vi.spyOn(LooService.prototype, "getReports").mockResolvedValue(mockReports);

    const res = await app.request(
      `/admin/loos/${mockLoo.id}`,
      { headers: authenticatedHeaders() },
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Loo details");
    expect(text).toContain(mockLoo.name ?? "");
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
      removalCategory: null,
      duplicateOf: null,
      radar: false,
      openingTimes,
      location: { lat: 51.501, lng: -0.141 },
    };

    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue(stubPrismaClient);
    // The edit page must read the record fresh (uncached), not via getById.
    const getMutationBase = vi
      .spyOn(LooService.prototype, "getMutationBase")
      .mockResolvedValue({ ...mockLoo, areaId: null });
    const getById = vi.spyOn(LooService.prototype, "getById");

    const res = await app.request(
      `/admin/loos/${mockLoo.id}/edit`,
      { headers: authenticatedHeaders() },
      env,
    );
    expect(res.status).toBe(200);
    expect(getMutationBase).toHaveBeenCalledWith(mockLoo.id);
    expect(getById).not.toHaveBeenCalled();

    const text = await res.text();
    const config = extractJsonConfig<{
      defaults: Record<string, unknown>;
      api: { update: string };
      looId: string;
      baseUpdatedAt: string | null;
    }>(text, "loo-edit-config");

    expect(config.looId).toBe(mockLoo.id);
    // The concurrency token the save is checked against.
    expect(config.baseUpdatedAt).toBe(mockLoo.updatedAt);
    expect(config.api.update).toBe(`/api/loos/${mockLoo.id}`);
    expect(config.defaults.openingTimes).toEqual(openingTimes);
    expect(config.defaults.lat).toBe(mockLoo.location?.lat.toString());
    expect(config.defaults.lng).toBe(mockLoo.location?.lng.toString());
    expect(config.defaults.name).toBe(mockLoo.name);
    expect(config.defaults.noPayment).toBe("true");
    expect(config.defaults.women).toBe("false");
  });

  it("should render a helpful state when trying to edit a missing loo", async () => {
    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue(stubPrismaClient);
    const getMutationBase = vi
      .spyOn(LooService.prototype, "getMutationBase")
      .mockResolvedValue(null);

    const res = await app.request(
      "/admin/loos/missing/edit",
      { headers: authenticatedHeaders() },
      env,
    );
    expect(res.status).toBe(200);
    expect(getMutationBase).toHaveBeenCalledWith("missing");
    const text = await res.text();
    expect(text).toContain("Loo not found");
    expect(text).toContain("Back to dataset");
  });

  it("should redirect to home when hitting /admin/logout", async () => {
    const res = await app.request("/admin/logout", { headers: authenticatedHeaders() }, env);
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
          removalCategory: null,
          duplicateOf: null,
          radar: null,
          openingTimes: null,
          location: null,
          looId: "loo_123",
          looName: "Test Loo",
          occurredAt: now,
        },
      ],
    };

    vi.spyOn(prismaModule, "createPrismaClient").mockReturnValue(stubPrismaClient);
    vi.spyOn(UserInsightsService.prototype, "getPopularContributors").mockResolvedValue([
      { handle: "Testy", contributions: 3 },
    ]);
    vi.spyOn(UserInsightsService.prototype, "getContributorStats").mockResolvedValue(stats);

    const res = await app.request(
      "/admin/users/statistics",
      { headers: authenticatedHeaders() },
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("User statistics");
    expect(text).toContain("Testy");
    expect(UserInsightsService.prototype.getContributorStats).toHaveBeenCalled();
  });

  it("should render the user administration page even when management credentials are missing", async () => {
    // Local development: without Management credentials the token's claims decide.
    const envWithoutMgmt: Env = {
      ...env,
      ENVIRONMENT: "development",
      AUTH0_MANAGEMENT_CLIENT_ID: "",
      AUTH0_MANAGEMENT_CLIENT_SECRET: "",
    };
    __adminRoleTestUtils.clearManagementClientCache();
    vi.mocked(Auth0ManagementClient.fromEnv).mockReturnValue(
      null as unknown as Auth0ManagementClient,
    );
    const appWithoutMgmt = createApp(envWithoutMgmt);
    const res = await appWithoutMgmt.request(
      "/admin/users/admin",
      { headers: authenticatedHeaders(undefined, envWithoutMgmt) },
      envWithoutMgmt,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("User administration");
    expect(text).toContain("Auth0 management disabled");
  });

  it("should grant permissions via the Auth0 management client", async () => {
    const addPermissions = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
      managementClientMock({ addPermissions, removePermissions: vi.fn() }),
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
      env,
    );

    expect(res.status).toBe(303);
    expect(addPermissions).toHaveBeenCalledWith("auth0|user123", ["access:admin"]);
  });

  it("should revoke permissions via the Auth0 management client", async () => {
    const removePermissions = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
      managementClientMock({ addPermissions: vi.fn(), removePermissions }),
    );

    const body = new URLSearchParams({
      user_id: "auth0|user456",
      permission: "access:admin",
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
      env,
    );

    expect(res.status).toBe(303);
    expect(removePermissions).toHaveBeenCalledWith("auth0|user456", ["access:admin"]);
  });

  it("no longer toggles report:loo, which direct writes do not use", async () => {
    const addPermissions = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
      managementClientMock({ addPermissions, removePermissions: vi.fn() }),
    );

    const res = await app.request(
      "/admin/users/admin/permissions",
      {
        method: "POST",
        headers: {
          ...authenticatedHeaders(),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          user_id: "auth0|user789",
          permission: "report:loo",
          intent: "grant",
        }).toString(),
      },
      env,
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("permissionError=unsupported_permission");
    expect(addPermissions).not.toHaveBeenCalled();
  });

  describe("permission notices never reflect URL text", () => {
    it("ignores an error message or permission name supplied in the query", async () => {
      const res = await app.request(
        `/admin/users/admin?${new URLSearchParams({
          permissionError: "Your session expired, call 0800 FAKE",
          permission: "Call 0800 FAKE",
          permissionStatus: "grant",
        })}`,
        { headers: authenticatedHeaders() },
        env,
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("0800 FAKE");
      expect(text).not.toContain("Permission update failed");
      // An unknown permission is named only generically.
      expect(text).toContain("Permission granted for");
    });

    it("maps a known code to its fixed message", async () => {
      const res = await app.request(
        "/admin/users/admin?permissionError=unsupported_action&permission=access%3Aadmin",
        { headers: authenticatedHeaders() },
        env,
      );
      const text = await res.text();
      expect(text).toContain("Permission update failed");
      expect(text).toContain("Unable to update Admin access: Unsupported action.");
    });

    it("redirects with a code, not Auth0's error text, when the change fails", async () => {
      vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
        managementClientMock({
          addPermissions: vi.fn().mockRejectedValue(new Error("Auth0 says: secret detail")),
          removePermissions: vi.fn(),
        }),
      );
      const res = await app.request(
        "/admin/users/admin/permissions",
        {
          method: "POST",
          headers: {
            ...authenticatedHeaders(),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            user_id: "auth0|user123",
            permission: "access:admin",
            intent: "grant",
          }).toString(),
        },
        env,
      );
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("permissionError=update_failed");
      expect(location).not.toContain("secret");
    });

    it("shows a fixed message when the Auth0 search fails", async () => {
      vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
        managementClientMock({
          searchUsers: vi.fn().mockRejectedValue(new Error("Bad query near 'evil text'")),
        }),
      );
      const res = await app.request(
        "/admin/users/admin?search=evil%20text",
        { headers: authenticatedHeaders() },
        env,
      );
      const text = await res.text();
      expect(text).toContain("Unable to search Auth0 users.");
      expect(text).not.toContain("Bad query");
    });
  });

  const ADMIN_HINT = "Blocking does not remove Admin access, so remove that below too.";

  it.each([
    [false, false, "To stop someone editing, block the user in the Auth0 dashboard."],
    [true, false, "This user is blocked in Auth0, so their changes are queued for moderation."],
    [false, true, `block the user in the Auth0 dashboard. ${ADMIN_HINT}`],
    [true, true, `their changes are queued for moderation. ${ADMIN_HINT}`],
  ])(
    "offers only the admin toggle and explains blocking (blocked: %s, admin: %s)",
    async (blocked, isAdmin, hint) => {
      const adminPermission = {
        permission_name: ADMIN_ROLE_ID,
        resource_server_identifier: env.AUTH0_AUDIENCE,
      };
      vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
        managementClientMock({
          // The signed-in admin keeps access:admin; the user on the page has it only if isAdmin.
          getUserPermissions: vi.fn((userId: string) =>
            Promise.resolve(userId !== "auth0|someone" || isAdmin ? [adminPermission] : []),
          ),
          getUser: vi
            .fn()
            .mockResolvedValue({ user_id: "auth0|someone", name: "Someone", blocked }),
        }),
      );

      const res = await app.request(
        "/admin/users/admin?user=auth0%7Csomeone",
        { headers: authenticatedHeaders() },
        env,
      );

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('value="access:admin"');
      expect(text).not.toContain("Loo contributions");
      expect(text).not.toContain('value="report:loo"');
      expect(text).toContain(hint);
      if (!isAdmin) expect(text).not.toContain(ADMIN_HINT);
    },
  );

  describe("fails closed when Auth0 cannot confirm admin access", () => {
    const expectDeniedKeepingSession = async (res: Response) => {
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("Admin access required");
      // An outage is no reason to sign the admin out.
      expect(res.headers.get("set-cookie") ?? "").not.toContain("access_token=;");
    };

    it("denies admin access outside development when Management credentials are missing", async () => {
      for (const ENVIRONMENT of ["preview", "production", undefined] as const) {
        const envWithoutMgmt: Env = {
          ...env,
          ENVIRONMENT,
          AUTH0_MANAGEMENT_CLIENT_ID: "",
          AUTH0_MANAGEMENT_CLIENT_SECRET: "",
        };
        const res = await createApp(envWithoutMgmt).request(
          "/admin",
          { headers: authenticatedHeaders(undefined, envWithoutMgmt) },
          envWithoutMgmt,
        );
        await expectDeniedKeepingSession(res);
      }
    });

    it("denies admin access when the permission lookup fails and there is no recent answer", async () => {
      mockGetUserPermissions.mockRejectedValue(new Error("Auth0 Management API unavailable"));
      const res = await app.request("/admin", { headers: authenticatedHeaders() }, env);
      await expectDeniedKeepingSession(res);
    });

    it("keeps using the last good answer for a short while when a later lookup fails", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const first = await app.request("/admin", { headers: authenticatedHeaders() }, env);
        expect(first.status).toBe(200);

        // Past the 60 s cache, inside the 5 min grace period.
        vi.setSystemTime(Date.now() + 2 * 60 * 1000);
        mockGetUserPermissions.mockRejectedValue(new Error("Auth0 Management API unavailable"));
        const second = await app.request("/admin", { headers: authenticatedHeaders() }, env);
        expect(second.status).toBe(200);

        // Past the grace period: denied.
        vi.setSystemTime(Date.now() + 10 * 60 * 1000);
        const third = await app.request("/admin", { headers: authenticatedHeaders() }, env);
        expect(third.status).toBe(403);
      } finally {
        vi.useRealTimers();
      }
    });

    it("denies a blocked admin and clears their session", async () => {
      mockIsUserBlocked.mockResolvedValue(true);
      const res = await app.request(
        "/admin/pending/some-change/approve",
        {
          method: "POST",
          headers: {
            ...authenticatedHeaders({ sub: "auth0|blocked-admin" }),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "",
        },
        env,
      );
      expect(mockIsUserBlocked).toHaveBeenCalledWith("auth0|blocked-admin");
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("Admin access required");
      expect(res.headers.get("set-cookie")?.toLowerCase()).toContain("max-age=0");
    });

    it("denies an admin whose block status cannot be confirmed", async () => {
      mockIsUserBlocked.mockRejectedValue(new Error("Auth0 Management API unavailable"));
      const res = await app.request("/admin", { headers: authenticatedHeaders() }, env);
      await expectDeniedKeepingSession(res);
    });
  });

  describe("CSRF: cookie-authenticated admin POSTs must be same-origin", () => {
    const post = (path: string, headers: Record<string, string>, body = "") =>
      app.request(
        path,
        {
          method: "POST",
          headers: {
            Cookie: buildSessionCookie(),
            "content-type": "application/x-www-form-urlencoded",
            ...headers,
          },
          body,
        },
        env,
      );

    const PATHS = [
      "/admin/users/admin/permissions",
      "/admin/pending/some-change/approve",
      "/admin/pending/some-change/reject",
      "/admin/dataset/regenerate",
      "/admin/feedback/some-feedback/delete",
    ];

    it.each(PATHS)("refuses a cross-site POST to %s with a 403 page", async (path) => {
      const addPermissions = vi.fn();
      vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
        managementClientMock({ addPermissions }),
      );
      const res = await post(path, { Origin: "https://evil.example" });
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("Request blocked");
      expect(addPermissions).not.toHaveBeenCalled();
      // Refused before authentication: the Management API was never asked.
      expect(mockGetUserPermissions).not.toHaveBeenCalled();
    });

    it.each([
      ["a same-site subdomain", { Origin: "http://api.localhost" }],
      ["a null Origin", { Origin: "null" }],
      ["a cross-site Sec-Fetch-Site without Origin", { "Sec-Fetch-Site": "cross-site" }],
      ["a same-site Sec-Fetch-Site without Origin", { "Sec-Fetch-Site": "same-site" }],
      ["neither Origin nor Sec-Fetch-Site", {}],
    ])("refuses %s", async (_label, headers) => {
      const res = await post("/admin/users/admin/permissions", headers);
      expect(res.status).toBe(403);
    });

    it.each([
      ["a same-origin Origin", { Origin: ADMIN_ORIGIN }],
      ["Sec-Fetch-Site: same-origin without Origin", { "Sec-Fetch-Site": "same-origin" }],
    ])("accepts %s", async (_label, headers) => {
      const addPermissions = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
        managementClientMock({ addPermissions, removePermissions: vi.fn() }),
      );
      const res = await post(
        "/admin/users/admin/permissions",
        headers,
        new URLSearchParams({
          user_id: "auth0|user123",
          permission: "access:admin",
          intent: "grant",
        }).toString(),
      );
      expect(res.status).toBe(303);
      expect(addPermissions).toHaveBeenCalled();
    });
  });

  describe("permission form redirect_to", () => {
    it.each([
      "//evil.example/admin",
      "/.//evil.example",
      "/admin/..//evil.example",
      "/\\evil.example",
      "/%2F%2Fevil.example",
      "/admin/%2E%2E/%2F%2Fevil.example",
      "https://evil.example/admin/users/admin",
      "javascript:alert(1)",
      "/loos/abc",
    ])("never redirects to %s", async (redirectTo) => {
      vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
        managementClientMock({ addPermissions: vi.fn().mockResolvedValue(undefined) }),
      );
      const res = await app.request(
        "/admin/users/admin/permissions",
        {
          method: "POST",
          headers: {
            ...authenticatedHeaders(),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            user_id: "auth0|user123",
            permission: "access:admin",
            intent: "grant",
            redirect_to: redirectTo,
          }).toString(),
        },
        env,
      );
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      expect(location.startsWith("/admin/users/admin?")).toBe(true);
      expect(location).toContain("user=auth0%7Cuser123");
    });

    it("keeps a safe admin path", async () => {
      vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue(
        managementClientMock({ addPermissions: vi.fn().mockResolvedValue(undefined) }),
      );
      const res = await app.request(
        "/admin/users/admin/permissions",
        {
          method: "POST",
          headers: {
            ...authenticatedHeaders(),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            user_id: "auth0|user123",
            permission: "access:admin",
            intent: "grant",
            redirect_to: "/admin/users/admin?search=abc",
          }).toString(),
        },
        env,
      );
      expect(res.headers.get("location")).toBe(
        "/admin/users/admin?search=abc&permissionStatus=grant&permission=access%3Aadmin",
      );
    });
  });

  it("sends no CORS headers on /admin, even to an allowed origin", async () => {
    const allowed = "https://www.toiletmap.org.uk";
    const corsEnv: Env = { ...env, ALLOWED_ORIGINS: allowed };
    const corsApp = createApp(corsEnv);
    const inits: RequestInit[] = [
      { headers: { ...authenticatedHeaders(), Origin: allowed } },
      {
        method: "OPTIONS",
        headers: { Origin: allowed, "Access-Control-Request-Method": "POST" },
      },
    ];
    for (const init of inits) {
      const res = await corsApp.request("/admin", init, corsEnv);
      for (const [name] of res.headers) {
        expect(name.toLowerCase().startsWith("access-control-")).toBe(false);
      }
    }
  });
});
