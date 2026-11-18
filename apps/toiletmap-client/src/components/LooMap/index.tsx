import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, IconButton } from "toiletmap-design-system";
import { getLooById, getLooDetail, type LooDetail, peekLooDetail } from "../../api/loos";
import { type ActiveFilters, DEFAULT_FILTERS, type FilterKey } from "../../types/filters";
import MapControlsPanel from "../MapControlsPanel";
import ToiletDetailsPanel from "../ToiletDetailsPanel";
import "./LooMap.css";
import MapMarkers from "./MapMarkers";
import {
  addToiletHref,
  DEFAULT_MAP_VIEW,
  type MapView,
  readMapView,
  writeMapView,
} from "./mapView";
import {
  consumeSavedParam,
  freshnessNotice,
  historyOpFor,
  idFromPath,
  initialLoadOutcome,
  interpretRefetch,
  isGoneFromMap,
  looPath,
  type MapDataChange,
  selectionNeedsRefresh,
} from "./selection";
import UserLocationMarker from "./UserLocationMarker";
import { type CompressedLoo, useMapData } from "./useMapData";
import { useUserLocation } from "./useUserLocation";
import {
  cardTopBelow,
  centreOffset,
  controlsInsets,
  insetsForRect,
  layoutChanged,
  NO_INSETS,
  type PanelLayout,
  panPadding,
  prefersReducedMotion,
  showDeveloperControls,
} from "./viewport";

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

/**
 * The developer controls are loaded only where they show (see showDeveloperControls), so a
 * production page never fetches them (DevTools carries the cache-clearing code).
 */
const DevTools = lazy(() => import("../DevTools"));
const DevToolsButton = lazy(() => import("../DevToolsButton"));
const SettingsPanel = lazy(() => import("../SettingsPanel"));

/** Marks history entries this map pushed, so closing the panel can step back over them. */
const PUSHED_STATE = { toiletmapSelection: true } as const;
const isPushedEntry = (state: unknown) =>
  !!state && typeof state === "object" && "toiletmapSelection" in state;

/** The closest a selected toilet is shown (a deep link, Back/Forward to one off screen). */
const SELECTED_MIN_ZOOM = 15;
/** The zoom "Find a toilet near me" shows the viewer's surroundings at. */
const NEAR_ME_ZOOM = 16;

/**
 * How to bring the selected toilet into view once the panel has rendered:
 * - "centre": centre it in the free part of the map (a deep link, or a toilet off screen);
 * - "inside": pan only as far as needed to keep it clear of the panel and controls.
 */
type Reveal = "centre" | "inside";

interface LooMapProps {
  apiUrl: string;
  initialToiletId?: string;
  /** Passed to the details panel for its restore copy (see ToiletDetailsPanel). */
  canWriteDirectly?: boolean;
  /**
   * The worker's ENVIRONMENT ("production", "preview", "development"), passed by the page.
   * The Settings gear and DevTools only show outside production (and in `astro dev`).
   */
  environment?: string;
}

export default function LooMap({
  apiUrl,
  initialToiletId,
  canWriteDirectly = false,
  environment = "production",
}: LooMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The map, as state, for children that add layers (set once Leaflet is created). */
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  /** What the open panel last reported covering (shared contract P1), until it closes. */
  const panelLayoutRef = useRef<PanelLayout | null>(null);
  /** A reveal waiting for the panel to render (see Reveal). */
  const pendingRevealRef = useRef<Reveal | null>(null);
  /** Filled by MapMarkers: focuses a toilet's marker (see focusMarkerRef there). */
  const focusMarkerRef = useRef<((id: string) => boolean) | null>(null);
  /** The toilet whose panel was just closed, to put focus back on its marker. */
  const closedIdRef = useRef<string | null>(null);
  const userLocation = useUserLocation();
  /** The top row of floating controls (search bar, developer buttons). */
  const chromeTopRef = useRef<HTMLDivElement>(null);
  /** Where the desktop details card starts: below the search bar, however tall it is. */
  const [cardTop, setCardTop] = useState<number | undefined>(undefined);
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

  // Where the map opens: the last view the user left it at, unless a /loos/{id} deep link
  // will move it to that toilet anyway.
  const [startView] = useState<MapView>(() =>
    initialToiletId ? DEFAULT_MAP_VIEW : (readMapView() ?? DEFAULT_MAP_VIEW),
  );
  /** The "Add a toilet here" link, following the map centre. */
  const [addHref, setAddHref] = useState(() => addToiletHref(startView));

  const handleFilterChange = (key: FilterKey, value: boolean) => {
    setActiveFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setActiveFilters(DEFAULT_FILTERS);
  };

  const showDevControls = showDeveloperControls(environment, !!import.meta.env.DEV);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const reducedMotion = prefersReducedMotion();
    const created = L.map(mapContainer.current, {
      zoomControl: false,
      // With reduced motion, zooming and panning jump instead of animating.
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
      markerZoomAnimation: !reducedMotion,
    }).setView([startView.lat, startView.lng], startView.zoom);
    map.current = created;
    setMapInstance(created);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(created);
    // Remember the view for next time, and keep "Add a toilet here" pointing at the centre.
    created.on("moveend", () => {
      const centre = created.getCenter();
      const view = { lat: centre.lat, lng: centre.lng, zoom: created.getZoom() };
      writeMapView(view);
      setAddHref(addToiletHref(view));
    });

    return () => {
      map.current?.remove();
      map.current = null;
      setMapInstance(null);
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

  /**
   * Id of the toilet being shown, updated as soon as the selection changes (selectedRef
   * only catches up on the next render).
   */
  const shownIdRef = useRef<string | null>(null);
  /**
   * Bumped by every selection and every Back/Forward, so a Back/Forward fetch that
   * resolves after the user has moved on is dropped.
   */
  const navigationRef = useRef(0);

  /** Show a toilet (or nothing), resetting per-toilet notices. */
  const showToilet = (toilet: LooDetail | null) => {
    const prevId = shownIdRef.current;
    if (prevId !== null && toilet === null) closedIdRef.current = prevId;
    if (toilet) closedIdRef.current = null;
    if (!toilet) {
      panelLayoutRef.current = null;
      pendingRevealRef.current = null;
    }
    shownIdRef.current = toilet?.id ?? null;
    setSelectedToilet(toilet);
    setRemovedId(toilet && toilet.active === false ? toilet.id : null);
  };

  /** A selection change that takes over from the initial /loos/{id} load, if still pending. */
  const takeOverSelection = (toilet: LooDetail | null) => {
    selectionMadeRef.current = true;
    showToilet(toilet);
  };

  /**
   * A selection made by the user (marker, close, Escape). If the initial /loos/{id} toilet
   * is still loading, it wins over that load and the late initial result is dropped (see
   * initialLoadOutcome).
   *
   * The address bar follows at once, against the URL as it is now: push only when opening
   * the panel from nothing, replace when switching toilets, and step back over our own
   * pushed entry when closing (so Back doesn't reopen what was just closed). This is done
   * here rather than in an effect, because effects run after the next paint, by which time
   * a Back/Forward may have moved the URL on and the stale change would be written over it.
   */
  const selectToilet = (toilet: LooDetail | null) => {
    const prevId = shownIdRef.current;
    const nextId = toilet?.id ?? null;
    navigationRef.current++;
    takeOverSelection(toilet);
    // A newly tapped toilet: once the panel is up, nudge the map so it isn't hidden under it.
    if (nextId !== null && nextId !== prevId) pendingRevealRef.current = "inside";
    // Unchanged (a revalidated copy, or a second close before Back has landed): the address
    // bar is, or is on its way to being, right already.
    if (prevId === nextId) return;
    const op = historyOpFor(prevId, nextId, window.location.pathname);
    if (!op) return;
    if (op.kind === "push") {
      history.pushState(PUSHED_STATE, "", op.url);
    } else if (nextId === null && isPushedEntry(history.state)) {
      history.back();
    } else {
      history.replaceState(history.state, "", op.url);
    }
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
      if (outcome.kind === "ignore") return;
      if (outcome.kind === "reset") {
        // The toilet couldn't be loaded: don't leave the address bar on a page we don't show.
        history.replaceState(history.state, "", outcome.url);
        return;
      }
      const { toilet } = outcome;
      showToilet(toilet);
      if (toilet.location && map.current) {
        // Jump there now; once the panel is up, centre it in the part of the map left free.
        map.current.setView(
          [toilet.location.lat, toilet.location.lng],
          Math.max(map.current.getZoom(), SELECTED_MIN_ZOOM),
          { animate: false },
        );
        pendingRevealRef.current = "centre";
      }
    });
  }, [apiUrl, initialToiletId]);

  // Back/Forward: make the selection follow the address bar. This never writes to history
  // (the browser already has); a cached copy shows at once, then the server's answer.
  useEffect(() => {
    const panTo = (detail: LooDetail) => {
      const m = map.current;
      if (!detail.location || !m) return;
      pendingRevealRef.current = m.getBounds().contains(detail.location) ? "inside" : "centre";
    };
    const onPopState = () => {
      const navigation = ++navigationRef.current;
      const id = idFromPath(window.location.pathname);
      if (id === shownIdRef.current) return;
      if (id === null) {
        takeOverSelection(null);
        return;
      }
      const cached = peekLooDetail(id);
      if (cached) {
        takeOverSelection(cached);
        panTo(cached);
      }
      getLooById(apiUrl, id).then((detail) => {
        // Ignore if unmounted, or the user has selected or navigated again since.
        if (!mountedRef.current || navigationRef.current !== navigation) return;
        if (idFromPath(window.location.pathname) !== id) return;
        if (!detail) {
          // getLooById falls back to the cached copy on failure, so with one shown this is
          // a 404: the toilet is gone. With nothing to show, don't leave the address bar
          // on a toilet that isn't open (as for the initial /loos/{id} load).
          if (cached) setRemovedId(id);
          else history.replaceState(history.state, "", looPath(null));
          return;
        }
        if (detail === cached) return;
        takeOverSelection(detail);
        if (!cached) panTo(detail);
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

  /**
   * How much of the map the panel covers: what it last reported, or (before its first
   * report) a measurement of its box.
   */
  const panelOccludes = (containerRect: DOMRect) => {
    if (panelLayoutRef.current) return panelLayoutRef.current.occludes;
    const panel = panelRef.current?.firstElementChild ?? null;
    return panel ? insetsForRect(panel.getBoundingClientRect(), containerRect) : NO_INSETS;
  };

  /**
   * Keeps the selected toilet's marker in the part of the map the user can see: clear of the
   * details panel and of the floating controls (anything marked `data-map-control`), with a
   * 16px margin. With reduced motion the map jumps rather than glides.
   */
  const revealSelected = (reveal: Reveal) => {
    const m = map.current;
    const root = rootRef.current;
    const location = selectedRef.current?.location;
    if (!m || !root || !mapContainer.current || !location) return;
    const containerRect = mapContainer.current.getBoundingClientRect();
    const size = { width: containerRect.width, height: containerRect.height };
    if (size.width <= 0 || size.height <= 0) return;
    const controls = controlsInsets(
      Array.from(root.querySelectorAll("[data-map-control]"), (el) => el.getBoundingClientRect()),
      containerRect,
    );
    const padding = panPadding(size, panelOccludes(containerRect), controls);
    const latlng: [number, number] = [location.lat, location.lng];
    if (reveal === "centre") {
      m.setView(latlng, Math.max(m.getZoom(), SELECTED_MIN_ZOOM), { animate: false });
      const [dx, dy] = centreOffset(size, padding);
      if (dx !== 0 || dy !== 0) m.panBy([dx, dy], { animate: false });
    } else {
      m.panInside(latlng, { ...padding, animate: !prefersReducedMotion() });
    }
  };

  /** Shared contract P1: the panel reports its size and position whenever they change. */
  const handlePanelLayout = (layout: PanelLayout) => {
    if (shownIdRef.current === null) return;
    const prev = panelLayoutRef.current;
    panelLayoutRef.current = layout;
    const pending = pendingRevealRef.current;
    pendingRevealRef.current = null;
    // Expanding (or switching to the card) can cover the marker: keep it in view.
    if (pending || layoutChanged(prev, layout)) revealSelected(pending ?? "inside");
  };

  // Once the panel for a new selection has rendered, bring its marker into view (unless the
  // panel's first layout report already did).
  useEffect(() => {
    if (!selectedToilet || !pendingRevealRef.current) return;
    const frame = requestAnimationFrame(() => {
      const pending = pendingRevealRef.current;
      pendingRevealRef.current = null;
      if (pending) revealSelected(pending);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedToilet]);

  // When the panel closes, put keyboard focus back on the marker that opened it (or the map),
  // unless the user has already moved focus somewhere else.
  useEffect(() => {
    if (selectedToilet || !closedIdRef.current) return;
    const id = closedIdRef.current;
    const frame = requestAnimationFrame(() => {
      if (closedIdRef.current !== id) return;
      closedIdRef.current = null;
      // The panel hands focus to the map (returnFocusTo) as it closes; from there, or from
      // nowhere (its marker was redrawn plain), move it on to the toilet's own marker.
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      if (!lost && active !== mapContainer.current) return;
      if (!focusMarkerRef.current?.(id)) mapContainer.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedToilet]);

  // Close the details panel when the user presses Escape. Listening for the map's whole
  // lifetime (not from an effect per open panel, which only runs after the next paint)
  // means Escape works as soon as the panel is on screen. Only Escape on the map itself (or
  // with nothing focused) counts: Escape in the page header's menu closes that menu, and
  // Escape inside the search bar or a dialog belongs to them (closing suggestions, the
  // settings sheet), not the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || shownIdRef.current === null) return;
      const target = e.target instanceof Element ? e.target : null;
      const unfocused = !target || target === document.body || target === document.documentElement;
      if (!unfocused && !rootRef.current?.contains(target)) return;
      if (target?.closest('[data-owns-escape], [role="dialog"], [aria-modal="true"]')) return;
      selectToilet(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the desktop card below the search bar as the bar grows (filters, suggestions).
  useEffect(() => {
    const chrome = chromeTopRef.current;
    const container = mapContainer.current;
    if (!chrome || !container) return;
    const measure = () => {
      const top = cardTopBelow(chrome.getBoundingClientRect(), container.getBoundingClientRect());
      setCardTop((prev) => (prev === top ? prev : top));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(chrome);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  /** "Find a toilet near me": start tracking the viewer, and centre on their first fix. */
  const handleFindNearMe = () => {
    userLocation.locate((fix) => {
      map.current?.setView([fix.lat, fix.lng], Math.max(map.current.getZoom(), NEAR_ME_ZOOM), {
        animate: !prefersReducedMotion(),
      });
    });
  };

  const zoomBy = (delta: 1 | -1) => {
    const m = map.current;
    if (!m) return;
    const options = { animate: !prefersReducedMotion() };
    if (delta > 0) m.zoomIn(1, options);
    else m.zoomOut(1, options);
  };

  return (
    <div className="loo-map-container" ref={rootRef}>
      {/* One flex row of floating controls: they can never overlap each other. */}
      <div className="map-chrome-top" ref={chromeTopRef}>
        <MapControlsPanel
          mapRef={map}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onResetFilters={handleResetFilters}
          onFindNearMe={handleFindNearMe}
          locationError={userLocation.error}
        />
        {showDevControls && (
          <div className="map-chrome-utilities" data-map-control>
            {/* Both buttons appear together, once the developer tools have loaded. */}
            <Suspense fallback={null}>
              <IconButton
                icon="gear"
                aria-label="Open settings"
                variant="filled"
                class="settings-btn"
                onClick={() => setIsSettingsOpen(true)}
              />
              <DevToolsButton class="dev-tools-btn" onClick={() => setIsDevToolsOpen(true)} />
            </Suspense>
          </div>
        )}
      </div>

      {showDevControls && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      <div id="map" ref={mapContainer} style={{ height: "100%", width: "100%" }} />
      <MapMarkers
        map={mapInstance}
        data={data}
        activeFilters={activeFilters}
        apiUrl={apiUrl}
        selectedToiletId={selectedToilet?.id ?? null}
        onToiletSelect={selectToilet}
        focusMarkerRef={focusMarkerRef}
      />
      <UserLocationMarker map={mapInstance} location={userLocation.location} />

      <div className="map-chrome-bottom-right">
        {/* Desktop only (CSS): phones pinch to zoom. */}
        <div className="map-zoom-controls" data-map-control>
          <IconButton
            icon="plus"
            aria-label="Zoom in"
            variant="ghost"
            class="map-zoom-btn"
            onClick={() => zoomBy(1)}
          />
          <IconButton
            icon="minus"
            aria-label="Zoom out"
            variant="ghost"
            class="map-zoom-btn"
            onClick={() => zoomBy(-1)}
          />
        </div>
        <div className="add-toilet-here" data-map-control>
          <Button htmlElement="a" variant="primary" href={addHref}>
            Add a toilet here
          </Button>
        </div>
      </div>

      {/*
       * The live region stays here for screen readers; while a toilet is open the notice is
       * shown in its panel instead (which would otherwise cover it), so this copy is hidden.
       * Only the shown notice covers the map (the hidden one is a 1px box).
       */}
      <div
        role="status"
        className={`map-freshness-notice${
          !notice
            ? ""
            : selectedToilet
              ? " map-freshness-notice--in-panel"
              : " map-freshness-notice--shown"
        }`}
        data-map-control={notice && !selectedToilet ? "" : undefined}
      >
        {notice}
      </div>

      {selectedToilet && (
        <div className="toilet-panel-layer" ref={panelRef}>
          <ToiletDetailsPanel
            key={selectedToilet.id}
            toilet={selectedToilet}
            onClose={() => selectToilet(null)}
            removed={removedId === selectedToilet.id}
            saved={savedId === selectedToilet.id}
            onDismissSaved={() => setSavedId(null)}
            canWriteDirectly={canWriteDirectly}
            onLayoutChange={handlePanelLayout}
            notice={notice ? <span aria-hidden="true">{notice}</span> : undefined}
            returnFocusTo={mapContainer.current}
            cardTop={cardTop}
            userLocation={userLocation.location ?? undefined}
          />
        </div>
      )}
    </div>
  );
}
