import { afterEach, beforeEach, type Mock, vi } from "vitest";
import { __adminRoleTestUtils } from "../../../src/middleware/require-admin-role";
import { Auth0ManagementClient } from "../../../src/services/auth0/management";
import { testProcessEnv } from "./env";

/** A user the stubbed Auth0 Management API reports as blocked. */
export const BLOCKED_SUB = "auth0|blocked-user";

/** A user whose block status the stubbed Auth0 Management API fails to return. */
export const LOOKUP_FAILS_SUB = "auth0|block-lookup-fails";

/** Env overrides that switch the Management API off, as in local dev without credentials. */
export const WITHOUT_MANAGEMENT_ENV = {
  AUTH0_MANAGEMENT_CLIENT_ID: "",
  AUTH0_MANAGEMENT_CLIENT_SECRET: "",
};

const MANAGEMENT_ENV = {
  AUTH0_MANAGEMENT_CLIENT_ID: "integration-management-client",
  AUTH0_MANAGEMENT_CLIENT_SECRET: "integration-management-secret",
} as const;

/**
 * For every test in the calling file: configures the Auth0 Management API and
 * stubs it, so `BLOCKED_SUB` is blocked, `LOOKUP_FAILS_SUB` errors and
 * everyone else is not blocked. Returns the `isUserBlocked` mock of the
 * current test.
 */
export const useAuth0ManagementStub = (): (() => Mock<(userId: string) => Promise<boolean>>) => {
  let isUserBlocked: Mock<(userId: string) => Promise<boolean>> | null = null;
  const saved: Partial<Record<keyof typeof MANAGEMENT_ENV, string | undefined>> = {};

  const clearCaches = () => {
    __adminRoleTestUtils.clearBlockedCache();
    __adminRoleTestUtils.clearManagementClientCache();
  };

  beforeEach(() => {
    clearCaches();
    for (const [key, value] of Object.entries(MANAGEMENT_ENV)) {
      saved[key as keyof typeof MANAGEMENT_ENV] = testProcessEnv[key];
      testProcessEnv[key] = value;
    }
    const stub = vi.fn((userId: string) =>
      userId === LOOKUP_FAILS_SUB
        ? Promise.reject(new Error("Auth0 Management API unavailable"))
        : Promise.resolve(userId === BLOCKED_SUB),
    );
    isUserBlocked = stub;
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue({
      isUserBlocked: stub,
    } as unknown as Auth0ManagementClient);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete testProcessEnv[key];
      else testProcessEnv[key] = value;
    }
    vi.restoreAllMocks();
    clearCaches();
  });

  return () => {
    if (!isUserBlocked) throw new Error("useAuth0ManagementStub: no test is running");
    return isUserBlocked;
  };
};
