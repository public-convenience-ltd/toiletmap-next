import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { __adminRoleTestUtils, ADMIN_ROLE_ID } from "../../src/middleware/require-admin-role";
import type { ExportSourceRecord } from "../../src/services/export/format";
import { LooService } from "../../src/services/loo";
import type { Env } from "../../src/types";
import { getTestContext } from "../integration/setup";
import { buildTestEnv } from "../integration/utils/env";
import { FakeR2Bucket } from "../integration/utils/r2-fake";

const ADMIN_SUB = "auth0|dataset-export-admin";

const sessionHeaders = (env: Env, permissions: string[] = [ADMIN_ROLE_ID]) => {
  const { issueToken } = getTestContext();
  const claims = { sub: ADMIN_SUB, permissions };
  const accessToken = issueToken(claims);
  const idToken = issueToken({
    ...claims,
    aud: env.AUTH0_CLIENT_ID,
    name: "Export Admin",
    email: "export-admin@example.com",
  });
  // Same-origin, as the admin's own form post sends.
  return {
    Cookie: `id_token=${idToken}; access_token=${accessToken}`,
    Origin: "https://admin.test",
  };
};

const exportRows = (count: number): ExportSourceRecord[] =>
  Array.from({ length: count }, (_, index) => ({
    id: (index + 1).toString(16).padStart(24, "0"),
    created_at: null,
    accessible: true,
    active: true,
    attended: null,
    automatic: null,
    baby_change: null,
    men: null,
    name: `Loo ${index}`,
    no_payment: null,
    notes: null,
    payment_details: null,
    radar: null,
    women: null,
    updated_at: null,
    urinal_only: null,
    all_gender: null,
    children: null,
    geohash: null,
    verified_at: null,
    area_id: null,
    opening_times: null,
    location: null,
    areas: null,
  }));

let bucket: FakeR2Bucket;
let getAllForExport: ReturnType<typeof vi.spyOn>;

const setup = (overrides: Partial<Env> = {}) => {
  const env = buildTestEnv({
    // No Auth0 Management API: the token's permissions are used as-is.
    AUTH0_MANAGEMENT_CLIENT_ID: undefined,
    AUTH0_MANAGEMENT_CLIENT_SECRET: undefined,
    ...overrides,
  });
  return { env, app: createApp(env) };
};

const regenerate = (
  { env, app }: ReturnType<typeof setup>,
  headers: Record<string, string> = sessionHeaders(env),
) => app.request("https://admin.test/admin/dataset/regenerate", { method: "POST", headers }, env);

beforeEach(() => {
  __adminRoleTestUtils.clearPermissionCache();
  bucket = new FakeR2Bucket();
  getAllForExport = vi
    .spyOn(LooService.prototype, "getAllForExport")
    .mockResolvedValue(exportRows(5) as Awaited<ReturnType<LooService["getAllForExport"]>>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Admin: regenerate dataset", () => {
  it("runs the export for an admin and redirects back with a result notice", async () => {
    const context = setup({ EXPORTS: bucket.asBinding() });
    const res = await regenerate(context);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/loos?export=published");
    expect(getAllForExport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(bucket.text("latest/manifest.json") ?? "{}")).toMatchObject({ rowCount: 5 });
  });

  it("hands the run to waitUntil, so a dropped connection cannot cut it off between writes", async () => {
    const context = setup({ EXPORTS: bucket.asBinding() });
    const waitUntil = vi.fn();
    const executionCtx = { waitUntil, passThroughOnException: () => undefined, props: {} };
    const res = await context.app.request(
      "https://admin.test/admin/dataset/regenerate",
      { method: "POST", headers: sessionHeaders(context.env) },
      context.env,
      executionCtx,
    );
    expect(res.headers.get("location")).toBe("/admin/loos?export=published");
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toMatchObject({ status: "published" });
  });

  it("refuses a second run within a few minutes", async () => {
    const context = setup({ EXPORTS: bucket.asBinding() });
    await regenerate(context);
    const again = await regenerate(context);
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe("/admin/loos?export=recent-run");
    expect(getAllForExport).toHaveBeenCalledTimes(1);
  });

  it("logs who triggered it by sub only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await regenerate(setup({ EXPORTS: bucket.asBinding() }));
    const lines = log.mock.calls.map((call) => call.join(" "));
    const requested = lines.find((line) => line.includes("Dataset export requested from admin"));
    expect(requested).toContain(ADMIN_SUB);
    expect(lines.join("\n")).not.toMatch(/@example\.com/);
  });

  it("is admin-only", async () => {
    const context = setup({ EXPORTS: bucket.asBinding() });
    const denied = await regenerate(context, sessionHeaders(context.env, []));
    expect(denied.status).toBe(403);

    const anonymous = await regenerate(context, {});
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("location")).toBe("/admin/login");

    expect(getAllForExport).not.toHaveBeenCalled();
    expect(bucket.puts()).toEqual([]);
  });

  it("refuses a cross-site form post", async () => {
    const context = setup({ EXPORTS: bucket.asBinding() });
    const res = await regenerate(context, {
      ...sessionHeaders(context.env),
      Origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(getAllForExport).not.toHaveBeenCalled();
  });

  it("says so when the bucket is not configured", async () => {
    const res = await regenerate(setup());
    expect(res.headers.get("location")).toBe("/admin/loos?export=not-configured");
    expect(getAllForExport).not.toHaveBeenCalled();
  });

  it("reports a refused publish", async () => {
    getAllForExport.mockResolvedValue([]);
    const res = await regenerate(setup({ EXPORTS: bucket.asBinding() }));
    expect(res.headers.get("location")).toBe("/admin/loos?export=empty");
  });
});

describe("Admin: dataset panel on the dataset explorer", () => {
  it("shows the latest manifest and the button", async () => {
    const context = setup({ EXPORTS: bucket.asBinding() });
    await regenerate(context);
    const res = await context.app.request(
      "https://admin.test/admin/loos?export=published",
      { headers: sessionHeaders(context.env) },
      context.env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Public dataset");
    expect(html).toMatch(/Last published [^<]*: 5 toilets, JSON [\d.]+ MB, CSV [\d.]+ MB\./);
    expect(html).toContain('action="/admin/dataset/regenerate"');
    expect(html).toContain("Regenerate dataset now");
    expect(html).toContain("Dataset regenerated and published.");
  });

  it("disables the button where the bucket is not bound, and ignores unknown notices", async () => {
    const context = setup();
    const res = await context.app.request(
      "https://admin.test/admin/loos?export=%3Cscript%3E",
      { headers: sessionHeaders(context.env) },
      context.env,
    );
    const html = await res.text();
    expect(html).toContain("Export storage is not configured in this environment");
    expect(html).toMatch(/<button type="submit" class="button button--secondary" disabled="">/);
    expect(html).not.toContain("data-dataset-export-notice");
  });
});
