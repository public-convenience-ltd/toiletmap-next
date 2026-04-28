import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { getLoosByIds } from "./loos";

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
