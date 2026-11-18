/**
 * The developer controls (Settings sheet, DevTools and its button) are loaded only where they
 * show, so a production page never fetches their code. Each module's mock records when it is
 * first imported: with a static import that would be as soon as LooMap itself loads.
 *
 * Its own file: once a test has loaded the modules, they stay loaded for the rest of the file.
 */
import { render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import LooMap from "./index";
import type { MapDataState } from "./useMapData";

const loaded = vi.hoisted(() => [] as string[]);

vi.mock("../DevTools", () => {
  loaded.push("DevTools");
  return { default: () => null };
});
vi.mock("../SettingsPanel", () => {
  loaded.push("SettingsPanel");
  return { default: () => null };
});
vi.mock("../DevToolsButton", () => {
  loaded.push("DevToolsButton");
  return {
    default: () => (
      <button type="button" aria-label="Developer Tools">
        *
      </button>
    ),
  };
});

const fakeMap = vi.hoisted(() => {
  const m: Record<string, unknown> = {
    getZoom: () => 13,
    getCenter: () => ({ lat: 51.5, lng: -0.1 }),
    getBounds: () => ({ contains: () => true }),
    remove: () => undefined,
    on: () => m,
  };
  m.setView = () => m;
  return m;
});
vi.mock("leaflet", () => ({
  default: {
    map: () => fakeMap,
    tileLayer: () => ({ addTo: () => undefined }),
  },
}));
vi.mock("./MapMarkers", () => ({ default: () => null }));
vi.mock("./UserLocationMarker", () => ({ default: () => null }));
vi.mock("../MapControlsPanel", () => ({ default: () => null }));
vi.mock("../ToiletDetailsPanel", () => ({ default: () => null }));
vi.mock("./useMapData", () => ({
  useMapData: (): MapDataState => ({
    data: [],
    loading: false,
    status: "ok",
    lastSyncedAt: Date.now(),
    version: 1,
    lastChange: null,
    refresh: () => undefined,
  }),
}));
vi.mock("../../api/loos", () => ({
  getLooById: vi.fn(async () => null),
  getLooDetail: vi.fn(async () => ({ loo: null, fresh: false })),
  peekLooDetail: vi.fn(() => null),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LooMap developer controls", () => {
  it("never loads them in a production build", async () => {
    vi.stubEnv("DEV", false);
    render(<LooMap apiUrl="" environment="production" />);
    // Give any dynamic import a chance to start.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loaded).toEqual([]);
    expect(screen.queryByRole("button", { name: "Open settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Developer Tools" })).not.toBeInTheDocument();
  });

  it("loads them on preview, showing the gear and DevTools buttons together", async () => {
    vi.stubEnv("DEV", false);
    render(<LooMap apiUrl="" environment="preview" />);
    expect(await screen.findByRole("button", { name: "Open settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Developer Tools" })).toBeInTheDocument();
    expect([...loaded].sort()).toEqual(["DevTools", "DevToolsButton", "SettingsPanel"]);
  });
});
