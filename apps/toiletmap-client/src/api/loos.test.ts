import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  clearLooDetailCache,
  evictLooDetail,
  getLooById,
  getLooDetail,
  getLoosByIds,
  LOO_DETAIL_CACHE_SIZE,
  type LooDetail,
  peekLooDetail,
  primeLooDetail,
} from "./loos";

describe("getLoosByIds", () => {
  const apiUrl = "https://api.example.com";
  const mockLoos = [
    { id: "1", name: "Loo 1" },
    { id: "2", name: "Loo 2" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return empty array if no ids provided", async () => {
    const result = await getLoosByIds(apiUrl, []);
    expect(result).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("should fetch loos from API", async () => {
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLoos }),
    });

    const result = await getLoosByIds(apiUrl, ["1", "2"]);
    expect(result).toEqual(mockLoos);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/loos?ids=1&ids=2"));
  });

  it("should chunk requests at 50 ids", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `${i}`);
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await getLoosByIds(apiUrl, ids);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("should handle API errors gracefully", async () => {
    (global.fetch as Mock).mockResolvedValue({
      ok: false,
      statusText: "Server Error",
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // noop
    });
    const result = await getLoosByIds(apiUrl, ["1"]);
    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("getLooById (in-memory SWR cache)", () => {
  const apiUrl = "";
  const loo = (id: string, name = `Loo ${id}`) => ({ id, name }) as unknown as LooDetail;
  const ok = (body: unknown, etag: string | null = null) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: etag ? { "Content-Type": "application/json", ETag: etag } : {},
    });
  let fetchMock: Mock;

  const ifNoneMatch = (call: number) =>
    new Headers((fetchMock.mock.calls[call][1] as RequestInit | undefined)?.headers).get(
      "If-None-Match",
    );

  beforeEach(() => {
    clearLooDetailCache();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches, stores the ETag and revalidates with If-None-Match; 304 keeps the cached object", async () => {
    fetchMock.mockResolvedValueOnce(ok(loo("a"), 'W/"loo-a-1"'));
    const first = await getLooById(apiUrl, "a");
    expect(first).toEqual(loo("a"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/loos/a");
    expect(ifNoneMatch(0)).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const second = await getLooById(apiUrl, "a");
    expect(ifNoneMatch(1)).toBe('W/"loo-a-1"');
    expect(second).toBe(first);
  });

  it("replaces the cached entry when the server returns a new version", async () => {
    fetchMock.mockResolvedValueOnce(ok(loo("a", "Old"), 'W/"loo-a-1"'));
    await getLooById(apiUrl, "a");
    fetchMock.mockResolvedValueOnce(ok(loo("a", "New"), 'W/"loo-a-2"'));
    expect((await getLooById(apiUrl, "a"))?.name).toBe("New");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await getLooById(apiUrl, "a");
    expect(ifNoneMatch(2)).toBe('W/"loo-a-2"');
  });

  it("returns the cached copy without a request when revalidate is false", async () => {
    primeLooDetail(loo("a"));
    expect(await getLooById(apiUrl, "a", { revalidate: false })).toEqual(loo("a"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the cached copy on server or network errors", async () => {
    primeLooDetail(loo("a"), 'W/"loo-a-1"');
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect(await getLooById(apiUrl, "a")).toEqual(loo("a"));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await getLooById(apiUrl, "a")).toEqual(loo("a"));
  });

  it("returns null and evicts on 404", async () => {
    primeLooDetail(loo("a"));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await getLooById(apiUrl, "a")).toBeNull();
    expect(peekLooDetail("a")).toBeNull();
  });

  it("returns null when nothing is cached and the request fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect(await getLooById(apiUrl, "zzz")).toBeNull();
  });

  it("getLooDetail flags a stale fallback (request failed) as not fresh", async () => {
    primeLooDetail(loo("a"), 'W/"loo-a-1"');
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await getLooDetail(apiUrl, "a")).toEqual({ loo: loo("a"), fresh: false });
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    expect(await getLooDetail(apiUrl, "a")).toEqual({ loo: loo("a"), fresh: false });
    expect(await getLooDetail(apiUrl, "a", { revalidate: false })).toEqual({
      loo: loo("a"),
      fresh: false,
    });
  });

  it("getLooDetail flags server answers (200, 304, 404) as fresh", async () => {
    fetchMock.mockResolvedValueOnce(ok(loo("a"), 'W/"loo-a-1"'));
    const first = await getLooDetail(apiUrl, "a");
    expect(first).toEqual({ loo: loo("a"), fresh: true });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const second = await getLooDetail(apiUrl, "a");
    expect(second.fresh).toBe(true);
    expect(second.loo).toBe(first.loo);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await getLooDetail(apiUrl, "a")).toEqual({ loo: null, fresh: true });
  });

  it("primeLooDetail seeds and evictLooDetail drops an entry", () => {
    primeLooDetail(loo("a"));
    expect(peekLooDetail("a")).toEqual(loo("a"));
    evictLooDetail("a");
    expect(peekLooDetail("a")).toBeNull();
  });

  it("evicts the least recently used entry beyond the size limit", async () => {
    for (let i = 0; i < LOO_DETAIL_CACHE_SIZE; i++) primeLooDetail(loo(`id${i}`));
    // Touch id0 so id1 becomes the least recently used.
    await getLooById(apiUrl, "id0", { revalidate: false });
    primeLooDetail(loo("extra"));
    expect(peekLooDetail("id0")).not.toBeNull();
    expect(peekLooDetail("id1")).toBeNull();
    expect(peekLooDetail("extra")).not.toBeNull();
  });
});
