import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { getLoosByIds, prefetchAll } from "./loos";

// Mock idb-keyval
vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
}));

import { get, set } from "idb-keyval";

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
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("should return cached loos if all are in cache", async () => {
    (get as Mock).mockImplementation((key: string) => {
      if (key === "loo:1") return Promise.resolve(mockLoos[0]);
      if (key === "loo:2") return Promise.resolve(mockLoos[1]);
      return Promise.resolve(undefined);
    });

    const result = await getLoosByIds(apiUrl, ["1", "2"]);
    expect(result).toEqual(mockLoos);
    expect(get).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("should fetch missing loos from API and cache them", async () => {
    // Cache miss for both
    (get as Mock).mockResolvedValue(undefined);

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLoos }),
    });

    const result = await getLoosByIds(apiUrl, ["1", "2"]);

    expect(result).toEqual(mockLoos);
    expect(get).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/loos?ids=1&ids=2"));
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith("loo:1", mockLoos[0]);
    expect(set).toHaveBeenCalledWith("loo:2", mockLoos[1]);
  });

  it("should combine cached and fetched loos", async () => {
    // Loo 1 in cache, Loo 2 missing
    (get as Mock).mockImplementation((key: string) => {
      if (key === "loo:1") return Promise.resolve(mockLoos[0]);
      return Promise.resolve(undefined);
    });

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [mockLoos[1]] }),
    });

    const result = await getLoosByIds(apiUrl, ["1", "2"]);

    // Result order might depend on implementation, but let's check contents
    expect(result).toContainEqual(mockLoos[0]);
    expect(result).toContainEqual(mockLoos[1]);
    expect(result).toHaveLength(2);

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/loos?ids=2"));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("loo:2", mockLoos[1]);
  });

  it("should handle API errors gracefully", async () => {
    (get as Mock).mockResolvedValue(undefined);
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

describe("prefetchAll", () => {
  const apiUrl = "https://api.example.com";
  const mockIds = Array.from({ length: 60 }, (_, i) => `${i}`); // 60 IDs to test chunking (50 is chunk size)

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    (get as Mock).mockResolvedValue(undefined); // Assume cache miss
    (set as Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch all loos in chunks", async () => {
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }), // Return empty data just to satisfy the call
    });

    await prefetchAll(apiUrl, mockIds);

    // Should be called twice: once for first 50, once for remaining 10
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("should report progress", async () => {
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const onProgress = vi.fn();
    await prefetchAll(apiUrl, mockIds, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 50, 60);
    expect(onProgress).toHaveBeenNthCalledWith(2, 60, 60);
  });
});
