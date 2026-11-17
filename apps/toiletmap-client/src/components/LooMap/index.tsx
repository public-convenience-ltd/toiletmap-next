import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { IconButton } from "toiletmap-design-system";
import { getLooById, getLooDetail, type LooDetail } from "../../api/loos";
import { type ActiveFilters, DEFAULT_FILTERS, type FilterKey } from "../../types/filters";
import DevTools from "../DevTools";
import DevToolsButton from "../DevToolsButton";
import MapControlsPanel from "../MapControlsPanel";
import SettingsPanel from "../SettingsPanel";
import ToiletDetailsPanel from "../ToiletDetailsPanel";
import "./LooMap.css";
import MapMarkers from "./MapMarkers";
import {
  consumeSavedParam,
  freshnessNotice,
  historyOpFor,
  idFromPath,
  initialLoadOutcome,
  interpretRefetch,
  isGoneFromMap,
  type MapDataChange,
  selectionNeedsRefresh,
} from "./selection";
import { type CompressedLoo, useMapData } from "./useMapData";

/**
 * What LooMap reads from useMapData. Everything but `data` is optional so the map degrades
 * gracefully: no status → no freshness notice; no change set → revalidate the open panel on
 * every data change (a cheap ETag 304).
 */
interface MapDataView {
  data: CompressedLoo[];
  /** "stale" (couldn't refresh) and "offline" show a notice; anything else shows none. */
  status?: string;
  /** Ids touched by the last update; null/absent when unknown (e.g. a full snapshot). */
  lastChange?: MapDataChange | null;
  /** When the shown data was last confirmed with the server. */
  lastSyncedAt?: number | string | Date | null;
}

/** Marks history entries this map pushed, so closing the panel can step back over them. */
const PUSHED_STATE = { toiletmapSelection: true } as const;
const isPushedEntry = (state: unknown) =>
  !!state && typeof state === "object" && "toiletmapSelection" in state;

interface LooMapProps {
  apiUrl: string;
  initialToiletId?: string;
}

export default function LooMap({ apiUrl, initialToiletId }: LooMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // True only for the initial /loos/{id} page load — cleared after first center
  const shouldCenterRef = useRef(!!initialToiletId);
  const mapData: MapDataView = useMapData(apiUrl);
  const { data } = mapData;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const [selectedToilet, setSelectedToilet] = useState<LooDetail | null>(null);
  const selectedRef = useRef<LooDetail | null>(null);
  selectedRef.current = selectedToilet;
  /** Id of the selected toilet once we know it has left the map (deleted or inactive). */
  const [removedId, setRemovedId] = useState<string | null>(null);
  /** Id the "your changes are live" banner belongs to (from `?saved=1`), until dismissed. */
  const [savedId, setSavedId] = useState<string | null>(() =>
    initialToiletId && consumeSavedParam(window.location.href).saved ? initialToiletId : null,
  );
  const mountedRef = useRef(true);

  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);

  const handleFilterChange = (key: FilterKey, value: boolean) => {
    setActiveFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setActiveFilters(DEFAULT_FILTERS);
  };

  const isDev = import.meta.env.DEV || import.meta.env.MODE === "preview";
  // True while we're waiting for the initial toilet from the URL to load
  const isInitialLoading = useRef(!!initialToiletId);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = L.map(mapContainer.current, { zoomControl: false }).setView([51.505, -0.09], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Strip `?saved=1` from the address bar once read, so a reload doesn't repeat the banner.
  useEffect(() => {
    const { cleanUrl } = consumeSavedParam(window.location.href);
    if (cleanUrl) history.replaceState(history.state, "", cleanUrl);
  }, []);

  /** True once the user has selected or closed anything (marker, Back/Forward, Escape). */
  const selectionMadeRef = useRef(false);

  /** Show a toilet (or nothing), resetting per-toilet notices. */
  const showToilet = (toilet: LooDetail | null) => {
    setSelectedToilet(toilet);
    setRemovedId(toilet && toilet.active === false ? toilet.id : null);
  };

  /**
   * A selection made by the user. If the initial /loos/{id} toilet is still loading, it
   * wins over that load: the address bar follows it at once and the late initial result
   * is dropped (see initialLoadOutcome).
   */
  const selectToilet = (toilet: LooDetail | null) => {
    selectionMadeRef.current = true;
    isInitialLoading.current = false;
    shouldCenterRef.current = false;
    showToilet(toilet);
  };

  // Pre-select toilet when navigating directly to /loos/{id} and pan the map to it
  useEffect(() => {
    if (!initialToiletId) return;
    getLooById(apiUrl, initialToiletId).then((detail) => {
      if (!mountedRef.current) return;
      const outcome = initialLoadOutcome(
        initialToiletId,
        detail,
        selectionMadeRef.current,
        window.location.pathname,
      );
      isInitialLoading.current = false;
      if (outcome.kind === "ignore") return;
      if (outcome.kind === "reset") {
        // The toilet couldn't be loaded: don't leave the address bar on a page we don't show.
        shouldCenterRef.current = false;
        history.replaceState(history.state, "", outcome.url);
        return;
      }
      const { toilet } = outcome;
      showToilet(toilet);
      if (toilet.location && map.current) {
        map.current.setView(
          [toilet.location.lat, toilet.location.lng],
          Math.max(map.current.getZoom(), 15),
          { animate: false },
        );
      }
    });
  }, [apiUrl, initialToiletId]);

  // Keep the address bar in step with the selection without a full page reload: push only
  // when opening the panel from nothing, replace when switching toilets, and step back over
  // our own pushed entry when closing (so Back doesn't reopen what was just closed).
  // Skip while the initial toilet is still loading to avoid a flash to "/".
  const prevSelectedIdRef = useRef<string | null>(null);
  const selectedId = selectedToilet?.id ?? null;
  useEffect(() => {
    const prevId = prevSelectedIdRef.current;
    prevSelectedIdRef.current = selectedId;
    if (isInitialLoading.current) return;
    const op = historyOpFor(prevId, selectedId, window.location.pathname);
    if (!op) return;
    if (op.kind === "push") {
      history.pushState(PUSHED_STATE, "", op.url);
    } else if (selectedId === null && isPushedEntry(history.state)) {
      history.back();
    } else {
      history.replaceState(history.state, "", op.url);
    }
  }, [selectedId]);

  // Back/Forward: make the selection follow the address bar.
  useEffect(() => {
    const onPopState = () => {
      const id = idFromPath(window.location.pathname);
      if (id === (selectedRef.current?.id ?? null)) return;
      if (id === null) {
        selectToilet(null);
        return;
      }
      getLooById(apiUrl, id).then((detail) => {
        // Ignore if unmounted, or the user has navigated again since.
        if (!mountedRef.current || idFromPath(window.location.pathname) !== id) return;
        selectToilet(detail);
        const m = map.current;
        if (detail?.location && m && !m.getBounds().contains(detail.location)) {
          m.setView([detail.location.lat, detail.location.lng], Math.max(m.getZoom(), 15));
        }
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [apiUrl]);

  // When the map data changes (a delta, another tab, our own save) or a server delta names
  // the open toilet (a name-only edit leaves its row unchanged), refresh the open panel
  // if its toilet was touched. A refetch that 404s or comes back inactive shows the removed
  // state. Results for a toilet that is no longer selected are dropped.
  const prevDataRef = useRef<CompressedLoo[]>(data);
  useEffect(() => {
    const prevData = prevDataRef.current;
    prevDataRef.current = data;
    const selected = selectedRef.current;
    if (!selected) return;
    const change = mapData.lastChange;
    if (!selectionNeedsRefresh(selected.id, prevData, data, change)) return;
    const id = selected.id;
    const gone = isGoneFromMap(id, data, change);
    getLooDetail(apiUrl, id, { revalidate: true }).then((result) => {
      if (!mountedRef.current || selectedRef.current?.id !== id) return;
      const outcome = interpretRefetch(result, gone);
      if (outcome.kind === "update") {
        setSelectedToilet(outcome.toilet);
        setRemovedId(null);
      } else if (outcome.kind === "removed") {
        setRemovedId(id);
      }
    });
  }, [data, mapData.lastChange]);

  const notice = freshnessNotice(mapData.status, mapData.lastSyncedAt);

  // On the initial /loos/{id} load only, offset the map so the marker sits
  // centred in the visible area above the details panel. Marker clicks skip
  // this — the user already sees the marker, just open the panel.
  useEffect(() => {
    if (!selectedToilet || !map.current || !panelRef.current) return;
    if (!shouldCenterRef.current) return;
    shouldCenterRef.current = false;
    const frame = requestAnimationFrame(() => {
      if (!map.current || !panelRef.current) return;
      const h = panelRef.current.clientHeight;
      if (h > 0) map.current.panBy([0, h / 2], { animate: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedToilet]);

  // Close the details panel when the user presses Escape
  useEffect(() => {
    if (!selectedToilet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectToilet(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedToilet]);

  return (
    <div className="loo-map-container">
      <MapControlsPanel
        mapRef={map}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
      />

      <IconButton
        icon="gear"
        aria-label="Open settings"
        variant="filled"
        class="settings-btn"
        onClick={() => setIsSettingsOpen(true)}
      />

      {isDev && <DevToolsButton class="dev-tools-btn" onClick={() => setIsDevToolsOpen(true)} />}

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onOpenDevTools={() => {
          setIsSettingsOpen(false);
          setIsDevToolsOpen(true);
        }}
      />

      <DevTools
        isOpen={isDevToolsOpen}
        onClose={() => setIsDevToolsOpen(false)}
        mapInstance={map.current}
      />

      <div id="map" ref={mapContainer} style={{ height: "100%", width: "100%" }} />
      <MapMarkers
        map={map.current}
        data={data}
        activeFilters={activeFilters}
        apiUrl={apiUrl}
        selectedToiletId={selectedToilet?.id ?? null}
        onToiletSelect={selectToilet}
      />

      <div
        role="status"
        className="map-freshness-notice"
        style={{
          position: "absolute",
          left: "var(--space-s)",
          bottom: "var(--space-l)",
          zIndex: 1000,
          maxWidth: "calc(100% - 2 * var(--space-s))",
          padding: notice ? "var(--space-3xs, 4px) var(--space-xs, 8px)" : 0,
          borderRadius: "var(--space-2xs, 6px)",
          background: notice ? "var(--color-base-white)" : "transparent",
          color: "var(--color-primary-navy)",
          boxShadow: notice ? "0 1px 6px rgba(10, 22, 94, 0.2)" : "none",
          fontSize: "0.875rem",
          pointerEvents: "none",
        }}
      >
        {notice}
      </div>

      {selectedToilet && (
        <div className="toilet-panel" ref={panelRef}>
          <ToiletDetailsPanel
            key={selectedToilet.id}
            toilet={selectedToilet}
            onClose={() => selectToilet(null)}
            removed={removedId === selectedToilet.id}
            saved={savedId === selectedToilet.id}
            onDismissSaved={() => setSavedId(null)}
          />
        </div>
      )}
    </div>
  );
}
