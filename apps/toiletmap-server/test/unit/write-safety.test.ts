import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMove } from "../../src/routes/loos/write-guards";
import { dailyCapAlertText, removalAlertText } from "../../src/services/moderation-alert";
import { DEFAULT_ACCOUNT_DAILY_CAP, parseAccountDailyCap } from "../../src/services/write-caps";
import {
  __writeModeTestUtils,
  getWriteMode,
  parseWriteMode,
  WRITE_MODE_CACHE_MS,
} from "../../src/services/write-mode";

const store = (value: string | null) => {
  const get = vi.fn(async () => value);
  return { get, binding: { get } as unknown as KVNamespace };
};

describe("parseWriteMode", () => {
  it.each([
    [null, "open"],
    [undefined, "open"],
    ["", "open"],
    ["  ", "open"],
    ["open", "open"],
    ["OPEN", "open"],
    ["queue", "queue"],
    ["read-only", "read-only"],
    ["readonly", "read-only"],
    ["read_only", "read-only"],
    [" Read-Only\n", "read-only"],
  ])("%j is %s", (value, mode) => {
    expect(parseWriteMode(value)).toBe(mode);
  });

  it("fails closed to read-only on an unknown value", () => {
    expect(parseWriteMode("lockdown")).toBe("read-only");
    expect(parseWriteMode("opne")).toBe("read-only");
  });
});

describe("getWriteMode", () => {
  beforeEach(() => __writeModeTestUtils.reset());

  it("is open without a SETTINGS binding", async () => {
    expect(await getWriteMode({})).toBe("open");
  });

  it(`caches the value per binding for ${WRITE_MODE_CACHE_MS / 1000}s`, async () => {
    const { get, binding } = store("queue");
    let now = 1_000_000;
    expect(await getWriteMode({ SETTINGS: binding }, () => now)).toBe("queue");
    now += WRITE_MODE_CACHE_MS - 1;
    expect(await getWriteMode({ SETTINGS: binding }, () => now)).toBe("queue");
    expect(get).toHaveBeenCalledTimes(1);
    now += 1;
    await getWriteMode({ SETTINGS: binding }, () => now);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith("write_mode");
  });

  it("reads a different binding afresh", async () => {
    expect(await getWriteMode({ SETTINGS: store("queue").binding })).toBe("queue");
    expect(await getWriteMode({ SETTINGS: store("read-only").binding })).toBe("read-only");
  });

  it("keeps the last value when KV fails, and is open with none", async () => {
    const get = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce("read-only");
    get.mockRejectedValue(new Error("KV down"));
    const binding = { get } as unknown as KVNamespace;
    let now = 0;
    expect(await getWriteMode({ SETTINGS: binding }, () => now)).toBe("read-only");
    now += WRITE_MODE_CACHE_MS;
    expect(await getWriteMode({ SETTINGS: binding }, () => now)).toBe("read-only");

    __writeModeTestUtils.reset();
    expect(await getWriteMode({ SETTINGS: binding }, () => now)).toBe("open");
  });
});

describe("parseAccountDailyCap", () => {
  it.each([
    [undefined, DEFAULT_ACCOUNT_DAILY_CAP],
    ["", DEFAULT_ACCOUNT_DAILY_CAP],
    ["ten", DEFAULT_ACCOUNT_DAILY_CAP],
    ["-1", DEFAULT_ACCOUNT_DAILY_CAP],
    ["2.5", DEFAULT_ACCOUNT_DAILY_CAP],
    ["0", 0],
    [" 25 ", 25],
  ])("%j gives %i", (value, cap) => {
    expect(parseAccountDailyCap(value)).toBe(cap);
  });

  it("defaults to 10", () => {
    expect(DEFAULT_ACCOUNT_DAILY_CAP).toBe(10);
  });
});

describe("isMove", () => {
  const here = { lat: 51.5, lng: -0.12 };
  it("is any change of an existing location", () => {
    expect(isMove(here, { lat: 51.50001, lng: -0.12 })).toBe(true);
    expect(isMove(here, { ...here })).toBe(false);
  });
  it("is not placing a toilet that had no location, or leaving it unchanged", () => {
    expect(isMove(null, here)).toBe(false);
    expect(isMove(here, undefined)).toBe(false);
  });
});

describe("alert texts", () => {
  const link = "https://api.example/admin/loos/0123456789abcdef01234567";
  it("removal alert: a count and a link", () => {
    expect(removalAlertText(1, link)).toBe(
      `1 toilet removed from the map in the last 24 hours. Latest direct removal: ${link}`,
    );
    expect(removalAlertText(3, link)).toMatch(/^3 toilets removed/);
  });
  it("daily-cap alert: the cap and a link", () => {
    expect(dailyCapAlertText(10, link)).toBe(
      `An account reached its daily limit of 10 removals and moves; its change to ${link} was queued for review (see /admin/pending).`,
    );
  });
});
