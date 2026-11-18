import { describe, expect, it } from "vitest";
import {
  AUTH_ERROR_KINDS,
  auth0ErrorKind,
  authErrorCopy,
  cleanAuthErrorDescription,
  MAX_AUTH_ERROR_DESCRIPTION,
  resolveAuthError,
} from "./authError";

describe("authErrorCopy", () => {
  it.each(AUTH_ERROR_KINDS)("has a heading, an explanation and an error status for %s", (kind) => {
    const copy = authErrorCopy(kind);
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.message.length).toBeGreaterThan(20);
    expect(copy.status).toBeGreaterThanOrEqual(400);
  });

  it("uses the statuses the cases deserve", () => {
    expect(authErrorCopy("denied").status).toBe(403);
    expect(authErrorCopy("expired").status).toBe(400);
    expect(authErrorCopy("state").status).toBe(400);
    expect(authErrorCopy("unavailable").status).toBe(503);
    expect(authErrorCopy("error").status).toBe(500);
  });

  it("gives every case its own heading (a cancelled sign-in isn't a failed one)", () => {
    const titles = AUTH_ERROR_KINDS.map((kind) => authErrorCopy(kind).title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(authErrorCopy("failed").title).toBe("We couldn't sign you in");
  });
});

describe("auth0ErrorKind", () => {
  it.each([
    ["access_denied", "denied"],
    ["unauthorized", "denied"],
    ["temporarily_unavailable", "unavailable"],
    ["server_error", "unavailable"],
    ["login_required", "expired"],
    ["consent_required", "expired"],
    ["interaction_required", "expired"],
    ["invalid_request", "failed"],
    ["something_new", "failed"],
  ])("%s → %s", (error, kind) => {
    expect(auth0ErrorKind(error)).toBe(kind);
  });
});

describe("cleanAuthErrorDescription", () => {
  it("keeps a short plain line", () => {
    expect(cleanAuthErrorDescription("  Please verify your email.  ")).toBe(
      "Please verify your email.",
    );
  });

  it("drops control characters and empty values", () => {
    expect(cleanAuthErrorDescription("line one\r\nline two\u0000")).toBe("line one line two");
    expect(cleanAuthErrorDescription("   ")).toBeUndefined();
    expect(cleanAuthErrorDescription(null)).toBeUndefined();
    expect(cleanAuthErrorDescription(undefined)).toBeUndefined();
  });

  it("truncates long descriptions", () => {
    const long = cleanAuthErrorDescription("x".repeat(1000)) ?? "";
    expect(long).toHaveLength(MAX_AUTH_ERROR_DESCRIPTION);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("resolveAuthError", () => {
  it("uses what the callback put in locals", () => {
    const info = { kind: "denied" as const, description: "Blocked", returnTo: "/loos/a" };
    expect(resolveAuthError({ authError: info }, "expired")).toBe(info);
  });

  it("otherwise takes only a known ?reason=, never text from the URL", () => {
    expect(resolveAuthError({}, "expired")).toEqual({ kind: "expired" });
    expect(resolveAuthError(undefined, "state")).toEqual({ kind: "state" });
    expect(resolveAuthError({}, "<script>")).toEqual({ kind: "failed" });
    expect(resolveAuthError({}, null)).toEqual({ kind: "failed" });
    expect(resolveAuthError({ authError: { kind: "nonsense" } }, null)).toEqual({ kind: "failed" });
  });
});
