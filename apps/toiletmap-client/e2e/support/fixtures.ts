import { type BrowserContext, test as base, expect, type Page } from "@playwright/test";
import {
  type ApiLoo,
  CONTRIBUTOR,
  createLooViaApi,
  e2eName,
  issueAccessToken,
  type LooInput,
  type MockUser,
  randomFixtureLocation,
} from "./api";
import { deleteLoos, deletePendingChanges } from "./db";
import { CLIENT_URL } from "./env";

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** Creates toilets for one test and deletes them (plus pending changes) afterwards. */
export interface LooFactory {
  /** Creates a toilet via the API as the mock "Test User". Name and location are randomised. */
  create(input?: Partial<LooInput>, label?: string): Promise<ApiLoo>;
  /** Registers a toilet created some other way (e.g. through the UI) for clean-up. */
  track(id: string): void;
  /** Registers a pending_change row for clean-up. */
  trackPendingChange(id: string): void;
}

type TestFixtures = {
  loos: LooFactory;
};

type WorkerFixtures = {
  /** Bearer token for direct API calls (mock Auth0 "Test User"). */
  apiToken: string;
  /** Cookies of a browser session that went through the real /auth/login flow. */
  authState: StorageState;
};

/** 1×1 transparent PNG served instead of OpenStreetMap tiles. */
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Never hit tile.openstreetmap.org from tests (usage policy, speed, flakiness).
 * Leaflet behaves the same with blank tiles.
 */
export async function blockMapTiles(context: BrowserContext): Promise<void> {
  await context.route(/^https:\/\/([a-z]\.)?tile\.openstreetmap\.org\//, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG }),
  );
}

/**
 * Signs in through the client's real flow: /auth/login → mock Auth0 login page
 * → "Continue as Test User" → /auth/callback (sets access_token, id_token and
 * the signed_in flag) → /.
 */
export async function signInThroughMockAuth(page: Page): Promise<void> {
  await page.goto("/auth/login");
  await page.getByRole("button", { name: /^Continue as / }).click();
  await page.waitForURL(`${CLIENT_URL}/`);
  const names = (await page.context().cookies(CLIENT_URL)).map((c) => c.name);
  expect(names, "callback should set the session cookies").toEqual(
    expect.arrayContaining(["access_token", "id_token", "signed_in"]),
  );
}

/**
 * The cookies /auth/callback would set (src/pages/auth/callback.ts), built from
 * a token issued by the mock Auth0 server (for `user`, or the default trusted
 * "Test User"), minus the `Secure` flag.
 * `id_token` is omitted: nothing in the client reads it after sign-in.
 */
export async function injectedSessionState(user?: MockUser): Promise<StorageState> {
  const accessToken = await issueAccessToken(user);
  const { hostname } = new URL(CLIENT_URL);
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  const cookie = { domain: hostname, path: "/", expires, secure: false, sameSite: "Lax" as const };
  return {
    cookies: [
      { ...cookie, name: "access_token", value: accessToken, httpOnly: true },
      { ...cookie, name: "signed_in", value: "1", httpOnly: false },
    ],
    origins: [],
  };
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  context: async ({ context }, use) => {
    await blockMapTiles(context);
    await use(context);
  },

  apiToken: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure
    async ({}, use) => {
      await use(await issueAccessToken());
    },
    { scope: "worker" },
  ],

  authState: [
    async ({ browser, browserName }, use) => {
      if (browserName === "webkit") {
        // WebKit does not store `Secure` cookies on http://localhost, so the
        // real flow cannot complete there (auth_state is dropped and the
        // callback answers 400). Inject equivalent cookies instead.
        await use(await injectedSessionState());
        return;
      }
      const context = await browser.newContext({ baseURL: CLIENT_URL });
      await blockMapTiles(context);
      const page = await context.newPage();
      await signInThroughMockAuth(page);
      const state = await context.storageState();
      await context.close();
      await use(state);
    },
    { scope: "worker" },
  ],

  loos: async ({ apiToken }, use) => {
    const looIds = new Set<string>();
    const pendingIds = new Set<string>();
    await use({
      async create(input = {}, label = "fixture") {
        const loo = await createLooViaApi(apiToken, {
          ...input,
          name: input.name ?? e2eName(label),
          location: input.location ?? randomFixtureLocation(),
        });
        looIds.add(loo.id);
        return loo;
      },
      track: (id) => looIds.add(id),
      trackPendingChange: (id) => pendingIds.add(id),
    });
    await deletePendingChanges([...pendingIds]);
    await deleteLoos([...looIds]);
  },
});

type AuthedTestFixtures = {
  /**
   * A page in a second, separate signed-in browser context (another person
   * editing at the same time). The context is closed after the test, also
   * when it fails.
   */
  secondEditor: Page;
};

/** Like `test`, but every page/context starts signed in. */
export const authedTest = test.extend<AuthedTestFixtures>({
  storageState: async ({ authState }, use) => {
    await use(authState);
  },

  secondEditor: async ({ browser, authState }, use) => {
    const context = await browser.newContext({ baseURL: CLIENT_URL, storageState: authState });
    try {
      await blockMapTiles(context);
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

type ContributorWorkerFixtures = {
  /** Cookies of a signed-in contributor with no Auth0 permissions. */
  contributorState: StorageState;
};

/**
 * Like `test`, but every page starts signed in as CONTRIBUTOR: a signed-in user with no
 * permissions, whose edits, reports and restores still go live straight away.
 */
export const contributorTest = test.extend<object, ContributorWorkerFixtures>({
  contributorState: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure
    async ({}, use) => {
      await use(await injectedSessionState(CONTRIBUTOR));
    },
    { scope: "worker" },
  ],
  storageState: async ({ contributorState }, use) => {
    await use(contributorState);
  },
});

export { expect };
