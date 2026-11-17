import L from "leaflet";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, InputField } from "toiletmap-design-system";
import { useNominatimSearch } from "../../hooks/useNominatimSearch";
import { getIconString, makeIcon } from "../LooMap/looIcon";
import {
  addToiletHref,
  DEFAULT_MAP_VIEW,
  type MapView,
  mapViewFromSearch,
  readMapView,
  toMapView,
} from "../LooMap/mapView";
import { distanceMeters, isValidLatLng, type LatLng } from "./geometry";
import { formatCoordinates, isInUk, parseCoordinates } from "./LocationPicker/coordinates";
import styles from "./LocationPicker/LocationPicker.module.css";
import { describeMove, formatDistance, NOT_MOVED_METERS } from "./LocationPicker/move";
import {
  buildProximityUrl,
  DUPLICATE_RADIUS_METERS,
  findNearbyMatch,
  NEARBY_MIN_ZOOM,
  NEARBY_RADIUS_METERS,
  type NearbyLoo,
  type NearbyMatch,
  parseProximityResponse,
} from "./LocationPicker/nearby";
import { shouldOfferLocationReset } from "./pinActions";

/** The picker never confirms a location from further out than this: the pin must be accurate. */
export const MIN_CONFIRM_ZOOM = 17;
/** Zoom used for the locked preview of a placed pin. */
const PLACED_ZOOM = 17;
/** Zoom "Use my location" and "Enter coordinates" go to (at least). */
const FOCUS_ZOOM = 18;
const NEARBY_DEBOUNCE_MS = 400;
/** A device fix less accurate than this (metres) gets an "approximate" note. */
const APPROXIMATE_FIX_METERS = 50;

export const ZOOM_IN_MESSAGE = "Zoom in closer to place the pin accurately";
export const BIG_MOVE_WARNING = "That's a big move — are you sure this is the same toilet?";

/** Leaflet's interaction handlers: all off for the locked preview, all on while moving. */
const INTERACTION_HANDLERS = [
  "dragging",
  "touchZoom",
  "scrollWheelZoom",
  "doubleClickZoom",
  "boxZoom",
  "keyboard",
] as const;

type Phase = "locked" | "moving";
type FocusTarget = "map" | "confirm" | "movePin" | "prompt" | null;
type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "error"; message: string }
  | { kind: "approximate"; message: string };

export interface LocationPickerProps {
  /** Current pin position, or null when no pin has been placed yet. */
  location: LatLng | null;
  /**
   * The saved location when editing an existing toilet: shown as a grey "ghost" pin while
   * moving, measured from by the "Moved 23 m north-east" chip, and restorable with
   * "Reset to original location".
   */
  originalLocation?: LatLng | null;
  /** Called only when the user confirms a new location ("Use this location", or reset). */
  onChange: (lat: number, lng: number) => void;
  /** Receives the picker's Leaflet map (and null on unmount). */
  onMapReady?: (map: L.Map | null) => void;
  mode: "add" | "edit";
  /** API origin for the nearby-toilets lookup. "" means same-origin. */
  apiUrl: string;
  /** The toilet being edited, left out of the nearby toilets and duplicate checks. */
  excludeId?: string;
  /** "Edit that toilet" on the duplicate prompt. Without it, a link to its edit page is shown. */
  onEditExisting?: (id: string) => void;
  /** "Restore it" on the removed-toilet prompt. Without it, a link to its page is shown. */
  onRestoreExisting?: (id: string) => void;
  /**
   * Where the map opens when there is no pin yet. Defaults (add mode) to `?lat&lng&zoom` in the
   * page URL, then the main map's last view, then central London.
   */
  initialView?: MapView | null;
  /** Told when the user starts (true) and stops (false) moving the pin, so a form can warn. */
  onMovingChange?: (moving: boolean) => void;
}

const round6 = (n: number) => Number(n.toFixed(6));
const toLatLng = (value: { lat: number; lng: number }): LatLng => ({
  lat: value.lat,
  lng: value.lng,
});
const hasValidLocation = (value: LatLng | null | undefined): value is LatLng =>
  !!value && isValidLatLng(value.lat, value.lng);

function resolveStartView(mode: "add" | "edit", initialView?: MapView | null): MapView {
  const given = initialView ? toMapView(initialView.lat, initialView.lng, initialView.zoom) : null;
  if (given) return given;
  if (mode === "add" && typeof window !== "undefined") {
    const fromUrl = mapViewFromSearch(window.location.search);
    if (fromUrl) return fromUrl;
  }
  return readMapView() ?? DEFAULT_MAP_VIEW;
}

function setInteractive(map: L.Map, on: boolean) {
  for (const name of INTERACTION_HANDLERS) {
    const handler = map[name] as L.Handler | undefined;
    if (!handler) continue;
    if (on) handler.enable();
    else handler.disable();
  }
}

const geolocationErrorMessage = (error: GeolocationPositionError | { code?: number }) =>
  error.code === 1
    ? "Location access is blocked. Allow it in your browser settings, or move the map to the toilet."
    : "We couldn't find your location. Move the map to the toilet instead.";

/**
 * Where the toilet is. Editing opens a locked preview with a "Move pin" button; moving (and
 * adding) pans the map under a fixed centre pin, so a stray tap or drag can never move the
 * toilet. Nothing reaches the form until the user confirms with "Use this location".
 */
export default function LocationPicker({
  location,
  originalLocation,
  onChange,
  onMapReady,
  mode,
  apiUrl,
  excludeId,
  onEditExisting,
  onRestoreExisting,
  initialView,
  onMovingChange,
}: LocationPickerProps) {
  const uid = useId();
  const ids = {
    search: `${uid}-search`,
    searchStatus: `${uid}-search-status`,
    coords: `${uid}-coords`,
    coordsHint: `${uid}-coords-hint`,
    coordsError: `${uid}-coords-error`,
    zoomNotice: `${uid}-zoom`,
  };

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinRef = useRef<L.Marker | null>(null);
  const ghostRef = useRef<L.Marker | null>(null);
  const nearbyLayerRef = useRef<L.LayerGroup | null>(null);
  const zoomControlRef = useRef<L.Control.Zoom | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<FocusTarget>(null);

  // Latest props for Leaflet handlers and async callbacks, which outlive a render.
  const latest = useRef({ location, originalLocation, onChange, apiUrl, excludeId });
  latest.current = { location, originalLocation, onChange, apiUrl, excludeId };
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const onMovingChangeRef = useRef(onMovingChange);
  onMovingChangeRef.current = onMovingChange;

  const [phase, setPhase] = useState<Phase>(() =>
    hasValidLocation(location) ? "locked" : "moving",
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // The map's live centre and zoom (the pin, while moving, is the centre).
  const [centre, setCentre] = useState<LatLng | null>(null);
  const [zoom, setZoom] = useState<number>(0);
  const [announcement, setAnnouncement] = useState("");

  const nearbyRef = useRef<{ centre: LatLng; loos: NearbyLoo[] } | null>(null);
  const [nearbyCount, setNearbyCount] = useState(0);
  const nearbyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyAbortRef = useRef<AbortController | null>(null);

  const [checking, setChecking] = useState(false);
  const [prompt, setPrompt] = useState<{ match: NearbyMatch; target: LatLng } | null>(null);
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });

  const [coordText, setCoordText] = useState(() => formatCoordinates(location));
  const [coordError, setCoordError] = useState<string | null>(null);
  /** True while the coordinate box holds text the user typed and hasn't used yet. */
  const coordDirtyRef = useRef(false);

  const search = useNominatimSearch({
    mapRef,
    selectZoom: FOCUS_ZOOM,
    fitResultBounds: true,
    maxZoom: FOCUS_ZOOM,
  });
  const searchRef = useRef<HTMLDivElement>(null);
  /** For the map's movestart handler, registered once: close the results when the map moves. */
  const dismissSearchRef = useRef(search.dismiss);
  dismissSearchRef.current = search.dismiss;
  const searchOpen = search.suggestions.length > 0;

  // A tap or click anywhere outside the search box closes its results.
  useEffect(() => {
    if (!searchOpen) return;
    const onPointerDown = (event: Event) => {
      const box = searchRef.current;
      if (box && event.target instanceof Node && !box.contains(event.target)) {
        dismissSearchRef.current();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [searchOpen]);

  // ── Nearby toilets ───────────────────────────────────────────

  const drawNearby = (loos: NearbyLoo[]) => {
    const layer = nearbyLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const loo of loos) {
      L.circleMarker([loo.location.lat, loo.location.lng], {
        radius: 7,
        weight: 2,
        color: "#5E6382",
        fillColor: "#5E6382",
        fillOpacity: loo.active ? 0.8 : 0,
        interactive: false,
        className: loo.active ? "picker-nearby" : "picker-nearby picker-nearby--removed",
      }).addTo(layer);
    }
    setNearbyCount(loos.length);
  };

  const clearNearby = () => {
    if (nearbyTimerRef.current) clearTimeout(nearbyTimerRef.current);
    nearbyTimerRef.current = null;
    nearbyAbortRef.current?.abort();
    nearbyAbortRef.current = null;
    nearbyLayerRef.current?.clearLayers();
    setNearbyCount(0);
  };

  /** Fetch the toilets around `at`. Null when the lookup failed (or was superseded). */
  const fetchNearby = async (at: LatLng, signal?: AbortSignal): Promise<NearbyLoo[] | null> => {
    const { apiUrl: api, excludeId: exclude } = latest.current;
    try {
      const res = await fetch(buildProximityUrl(api, at, exclude), {
        signal,
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!res.ok) return null;
      const loos = parseProximityResponse(await res.json());
      nearbyRef.current = { centre: at, loos };
      return loos;
    } catch {
      return null; // best effort (aborts land here too)
    }
  };

  const scheduleNearby = () => {
    const map = mapRef.current;
    if (nearbyTimerRef.current) clearTimeout(nearbyTimerRef.current);
    nearbyTimerRef.current = null;
    if (!map || phaseRef.current !== "moving") return;
    if (map.getZoom() < NEARBY_MIN_ZOOM) {
      clearNearby();
      return;
    }
    nearbyTimerRef.current = setTimeout(async () => {
      nearbyTimerRef.current = null;
      nearbyAbortRef.current?.abort();
      const controller = new AbortController();
      nearbyAbortRef.current = controller;
      const loos = await fetchNearby(toLatLng(map.getCenter()), controller.signal);
      if (controller.signal.aborted || phaseRef.current !== "moving") return;
      if (nearbyAbortRef.current === controller) nearbyAbortRef.current = null;
      if (loos) drawNearby(loos);
    }, NEARBY_DEBOUNCE_MS);
  };

  /** Nearby toilets for a duplicate check at `target`: the last lookup if it covers it, else a new one. */
  const nearbyFor = async (target: LatLng): Promise<NearbyLoo[]> => {
    const cached = nearbyRef.current;
    if (
      cached &&
      distanceMeters(cached.centre, target) <= NEARBY_RADIUS_METERS - DUPLICATE_RADIUS_METERS
    ) {
      return cached.loos;
    }
    return (await fetchNearby(target)) ?? [];
  };

  // ── Map setup ────────────────────────────────────────────────

  useLayoutEffect(() => {
    if (!container.current || mapRef.current) return;
    const start = hasValidLocation(location)
      ? { lat: location.lat, lng: location.lng, zoom: PLACED_ZOOM }
      : resolveStartView(mode, initialView);
    const moving = phaseRef.current === "moving";
    const map = L.map(container.current, {
      zoomControl: false,
      dragging: moving,
      touchZoom: moving,
      scrollWheelZoom: moving,
      doubleClickZoom: moving,
      boxZoom: moving,
      keyboard: moving,
    }).setView([start.lat, start.lng], start.zoom);
    mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    nearbyLayerRef.current = L.layerGroup().addTo(map);

    // No click/tap handler, ever: the pin is the map centre (while moving) or fixed (locked).
    const syncView = () => {
      setCentre(toLatLng(map.getCenter()));
      setZoom(map.getZoom());
    };
    map.on("move zoomend", syncView);
    map.on("movestart", () => {
      setPrompt(null);
      dismissSearchRef.current();
    });
    map.on("moveend", () => {
      syncView();
      scheduleNearby();
    });
    syncView();
    onMapReadyRef.current?.(map);
    return () => {
      onMapReadyRef.current?.(null);
      if (nearbyTimerRef.current) clearTimeout(nearbyTimerRef.current);
      nearbyAbortRef.current?.abort();
      map.remove();
      mapRef.current = null;
      pinRef.current = null;
      ghostRef.current = null;
      nearbyLayerRef.current = null;
      zoomControlRef.current = null;
    };
  }, []);

  // ── Phase: locked preview vs moving ──────────────────────────

  const showGhost =
    hasValidLocation(originalLocation) &&
    (phase === "moving" || shouldOfferLocationReset(originalLocation, location));

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const moving = phase === "moving";
    setInteractive(map, moving);
    if (moving && !zoomControlRef.current) {
      zoomControlRef.current = L.control.zoom({ position: "topright" }).addTo(map);
    } else if (!moving && zoomControlRef.current) {
      zoomControlRef.current.remove();
      zoomControlRef.current = null;
    }
    if (moving) {
      scheduleNearby();
    } else {
      clearNearby();
      setGeo({ kind: "idle" });
    }
    onMovingChangeRef.current?.(moving);
  }, [phase]);

  // The locked pin follows the confirmed location; the view re-centres on it.
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (phase === "moving" || !hasValidLocation(location)) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }
    const at: [number, number] = [location.lat, location.lng];
    if (pinRef.current) {
      pinRef.current.setLatLng(at);
    } else {
      pinRef.current = L.marker(at, {
        icon: makeIcon("default"),
        interactive: false,
        keyboard: false,
      }).addTo(map);
    }
    const centreNow = map.getCenter();
    if (distanceMeters(toLatLng(centreNow), location) > NOT_MOVED_METERS) {
      map.setView(at, Math.max(map.getZoom(), PLACED_ZOOM), { animate: false });
    }
  }, [phase, location?.lat, location?.lng]);

  // The ghost pin marks the saved location while it is not where the toilet is going.
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showGhost || !originalLocation) {
      ghostRef.current?.remove();
      ghostRef.current = null;
      return;
    }
    const at: [number, number] = [originalLocation.lat, originalLocation.lng];
    if (ghostRef.current) {
      ghostRef.current.setLatLng(at);
    } else {
      ghostRef.current = L.marker(at, {
        icon: makeIcon("muted"),
        interactive: false,
        keyboard: false,
        zIndexOffset: -1000,
      }).addTo(map);
    }
  }, [showGhost, originalLocation?.lat, originalLocation?.lng]);

  // Re-sync the coordinate box only when the location changed for another reason (a confirmed
  // move, a reset, a rebase), never over text the user is still typing.
  useEffect(() => {
    if (coordDirtyRef.current) return;
    setCoordText(formatCoordinates(hasValidLocation(location) ? location : null));
    setCoordError(null);
  }, [location?.lat, location?.lng]);

  // Move focus where an action said it should go, as soon as the DOM has caught up.
  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    const el =
      target === "map"
        ? container.current
        : rootRef.current?.querySelector<HTMLElement>(`[data-focus="${target}"]`);
    el?.focus();
  });

  // ── Actions ──────────────────────────────────────────────────

  const startMoving = (focus: FocusTarget = "map") => {
    setPrompt(null);
    pendingFocusRef.current = focus;
    setAnnouncement(
      "Move the map until the pin in the centre is on the toilet, then choose Use this location.",
    );
    setPhase("moving");
  };

  const finishMoving = () => {
    setPrompt(null);
    setChecking(false);
    pendingFocusRef.current = "movePin";
    setPhase("locked");
  };

  const cancelMoving = () => {
    // Nothing was sent to the form while moving: the pin is still where it was.
    setAnnouncement("Move cancelled. The pin is where it was.");
    finishMoving();
  };

  /** Send the confirmed spot to the form (exactly the original if it is back there). */
  const commit = (target: LatLng) => {
    const { location: current, originalLocation: original, onChange: emit } = latest.current;
    if (hasValidLocation(original) && distanceMeters(original, target) <= NOT_MOVED_METERS) {
      if (!current || current.lat !== original.lat || current.lng !== original.lng) {
        emit(original.lat, original.lng); // unrounded, so the form sees no change at all
      }
    } else if (!hasValidLocation(current) || distanceMeters(current, target) > NOT_MOVED_METERS) {
      emit(round6(target.lat), round6(target.lng));
    }
    setAnnouncement("Location set.");
    finishMoving();
  };

  const confirm = async () => {
    const map = mapRef.current;
    if (!map || checking) return;
    if (map.getZoom() < MIN_CONFIRM_ZOOM) return;
    const target = toLatLng(map.getCenter());
    const original = latest.current.originalLocation;
    const savedSpot = mode === "edit" && hasValidLocation(original) ? original : null;
    // Not moved at all: there is nothing new to check against.
    if (savedSpot && distanceMeters(savedSpot, target) <= NOT_MOVED_METERS) {
      commit(target);
      return;
    }
    setChecking(true);
    const nearby = await nearbyFor(target);
    setChecking(false);
    if (phaseRef.current !== "moving" || mapRef.current !== map) return;
    // The user moved on while we looked: they'll confirm again from the new spot.
    if (distanceMeters(toLatLng(map.getCenter()), target) > NOT_MOVED_METERS) return;
    // Editing: only a toilet the pin was moved towards, and never a removed one ("Restore it"
    // is for someone adding a toilet that used to be there).
    const match = findNearbyMatch(target, nearby, latest.current.excludeId, undefined, {
      original: savedSpot,
      includeRemoved: mode !== "edit",
    });
    if (match) {
      pendingFocusRef.current = "prompt";
      setPrompt({ match, target });
      return;
    }
    commit(target);
  };

  /** Put the pin back where it was saved, straight away, from either phase. */
  const resetToOriginal = () => {
    const map = mapRef.current;
    const { originalLocation: original, location: current, onChange: emit } = latest.current;
    if (!map || !hasValidLocation(original)) return;
    setPrompt(null);
    // Unrounded, so the form sees no location change at all.
    if (!current || current.lat !== original.lat || current.lng !== original.lng) {
      emit(original.lat, original.lng);
    }
    map.setView([original.lat, original.lng], Math.max(map.getZoom(), PLACED_ZOOM), {
      animate: false,
    });
    setAnnouncement("The pin is back at the original location.");
    if (phaseRef.current === "moving") {
      finishMoving(); // focus goes to Move pin
    } else {
      // The focused Reset button is about to disappear: keep focus in the picker.
      pendingFocusRef.current = "movePin";
    }
  };

  const zoomIn = () => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(MIN_CONFIRM_ZOOM);
    pendingFocusRef.current = "confirm";
  };

  const selectSuggestion = (s: (typeof search.suggestions)[number]) => {
    search.handleSuggestionSelect(s);
    pendingFocusRef.current = "map";
    setAnnouncement(`Map moved to ${s.display_name}.`);
  };

  const geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined;

  const locateMe = () => {
    if (!geolocation) return;
    setGeo({ kind: "locating" });
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const map = mapRef.current;
          if (!map) return;
          const { latitude, longitude, accuracy } = position.coords;
          if (!isInUk(latitude, longitude)) {
            setGeo({
              kind: "error",
              message: "You seem to be outside the UK. Move the map to the toilet instead.",
            });
            return;
          }
          if (phaseRef.current !== "moving") setPhase("moving");
          map.setView([latitude, longitude], Math.max(map.getZoom(), FOCUS_ZOOM), {
            animate: false,
          });
          setGeo(
            Number.isFinite(accuracy) && accuracy > APPROXIMATE_FIX_METERS
              ? {
                  kind: "approximate",
                  message: `Your location is only accurate to about ${formatDistance(accuracy)}. Check the pin is on the toilet.`,
                }
              : { kind: "idle" },
          );
          setAnnouncement("Map moved to your location.");
        },
        (error) => setGeo({ kind: "error", message: geolocationErrorMessage(error) }),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      );
    } catch {
      setGeo({ kind: "error", message: geolocationErrorMessage({}) });
    }
  };

  const showCoordinates = () => {
    const map = mapRef.current;
    const parsed = parseCoordinates(coordText);
    if (!parsed.ok) {
      setCoordError(parsed.error);
      return;
    }
    setCoordError(null);
    coordDirtyRef.current = false;
    if (!map) return;
    setPrompt(null);
    pendingFocusRef.current = "confirm";
    if (phaseRef.current !== "moving") setPhase("moving");
    map.setView([parsed.lat, parsed.lng], Math.max(map.getZoom(), FOCUS_ZOOM), { animate: false });
    setAnnouncement(
      `Map moved to ${formatCoordinates(parsed)}. Check the pin, then choose Use this location.`,
    );
  };

  // ── Render ───────────────────────────────────────────────────

  const moving = phase === "moving";
  const hasLocation = hasValidLocation(location);
  const original = hasValidLocation(originalLocation) ? originalLocation : null;
  const move = moving && original && centre ? describeMove(original, centre) : null;
  const zoomTooFar = moving && zoom < MIN_CONFIRM_ZOOM;
  const showLockedReset = !moving && shouldOfferLocationReset(original, location);
  const lockedMove = !moving && original && hasLocation ? describeMove(original, location) : null;

  const renderPrompt = () => {
    if (!prompt) return null;
    const { match, target } = prompt;
    const distance = formatDistance(match.distance);
    const name = match.loo.name ?? "an unnamed toilet";
    return (
      <fieldset class={styles.prompt} tabIndex={-1} data-focus="prompt">
        <legend class={styles.promptText}>
          {match.kind === "active" ? (
            <>
              There's already a toilet {distance} away: <strong>{name}</strong>. Is it the same one?
            </>
          ) : (
            <>A removed toilet was recorded {distance} away. Is this the same toilet, back again?</>
          )}
        </legend>
        <div class={styles.actions}>
          {match.kind === "active" ? (
            onEditExisting ? (
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={() => onEditExisting(match.loo.id)}
              >
                Edit that toilet
              </Button>
            ) : (
              <Button
                htmlElement="a"
                variant="primary"
                href={`/loos/${encodeURIComponent(match.loo.id)}/edit`}
              >
                Edit that toilet
              </Button>
            )
          ) : onRestoreExisting ? (
            <Button
              htmlElement="button"
              type="button"
              variant="primary"
              onClick={() => onRestoreExisting(match.loo.id)}
            >
              Restore it
            </Button>
          ) : (
            <Button
              htmlElement="a"
              variant="primary"
              href={`/loos/${encodeURIComponent(match.loo.id)}`}
            >
              Restore it
            </Button>
          )}
          <Button
            htmlElement="button"
            type="button"
            variant="secondary"
            onClick={() => commit(target)}
          >
            No, this is a different toilet
          </Button>
        </div>
      </fieldset>
    );
  };

  return (
    <div class={styles.root} data-phase={phase} ref={rootRef}>
      {moving && (
        <div class={styles.toolbar}>
          <div
            class={styles.search}
            ref={searchRef}
            onFocusOut={(e) => {
              // Tabbing out of the search box (and its results) closes them.
              const next = e.relatedTarget;
              if (next instanceof Node && !searchRef.current?.contains(next)) search.dismiss();
            }}
          >
            <label class={styles.label} for={ids.search}>
              Search for a place
            </label>
            <InputField
              id={ids.search}
              type="search"
              class={styles.input}
              placeholder="Street, postcode or place"
              value={search.query}
              autoComplete="off"
              aria-describedby={ids.searchStatus}
              onInput={(e) => search.handleSearchInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Never submit the surrounding form from here. The keyboard's Go / Search key
                  // picks the first result, or searches now if there are none yet.
                  e.preventDefault();
                  const first = search.suggestions[0];
                  if (first) selectSuggestion(first);
                  else search.searchNow();
                } else if (e.key === "Escape" && searchOpen) {
                  e.preventDefault();
                  search.dismiss();
                }
              }}
            />
            <p id={ids.searchStatus} class={styles.searchStatus} role="status" aria-live="polite">
              {search.isSearching
                ? "Searching…"
                : search.noResults
                  ? "No places found. Try a postcode or street name."
                  : ""}
            </p>
            {searchOpen && (
              <ul class={styles.suggestions} aria-label="Search results">
                {search.suggestions.map((s) => (
                  <li key={s.place_id}>
                    <button
                      type="button"
                      class={styles.suggestion}
                      onClick={() => selectSuggestion(s)}
                    >
                      {s.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {geolocation && (
            <Button
              htmlElement="button"
              type="button"
              variant="secondary"
              onClick={locateMe}
              disabled={geo.kind === "locating"}
            >
              {geo.kind === "locating" ? "Finding you…" : "Use my location"}
            </Button>
          )}
        </div>
      )}
      {moving && (geo.kind === "error" || geo.kind === "approximate") && (
        <p class={geo.kind === "error" ? styles.error : styles.hint} role="alert">
          {geo.message}
        </p>
      )}

      <div class={moving ? `${styles.mapWrap} ${styles.mapWrapMoving}` : styles.mapWrap}>
        {/* The container's class must never change after mount: Leaflet adds its own classes
            (leaflet-container: overflow hidden; leaflet-touch-drag: touch-action none) to it,
            and a changed `class` prop would make Preact overwrite them. */}
        <div
          class={styles.map}
          ref={container}
          role="application"
          aria-roledescription="map"
          aria-label={
            moving
              ? "Move the map with the arrow keys or by dragging; the pin stays in the centre."
              : "Preview of where the toilet is. Choose Move pin to change it."
          }
          tabIndex={moving ? 0 : -1}
        />
        {moving && (
          <>
            <span class={styles.centrePin} aria-hidden="true">
              <span
                class={styles.centrePinIcon}
                dangerouslySetInnerHTML={{ __html: getIconString("default") }}
              />
            </span>
            <span class={styles.centreDot} aria-hidden="true" />
          </>
        )}
        {move && (
          <span
            class={move.big ? `${styles.chip} ${styles.chipWarning}` : styles.chip}
            aria-hidden="true"
          >
            {move.label}
          </span>
        )}
      </div>

      <div class={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </div>

      {moving ? (
        <div class={styles.panel}>
          <p class={styles.hint}>
            {mode === "add"
              ? "Move and zoom the map until the pin is on the toilet's entrance."
              : "Move the map until the pin is on the toilet's new position."}
            {original && " The grey pin shows where it was."}
            {nearbyCount > 0 &&
              " Grey dots are toilets already on the map; hollow ones have been removed."}
          </p>

          {move?.big && (
            <div class={styles.warning} role="alert">
              <p>{BIG_MOVE_WARNING}</p>
              {centre && (
                <a href={addToiletHref({ lat: centre.lat, lng: centre.lng, zoom })}>
                  Add as a new toilet instead
                </a>
              )}
            </div>
          )}

          {renderPrompt()}

          {!prompt && (
            <>
              {zoomTooFar && (
                <p id={ids.zoomNotice} class={styles.zoomNotice}>
                  {ZOOM_IN_MESSAGE}{" "}
                  <button type="button" class={styles.linkButton} onClick={zoomIn}>
                    Zoom in
                  </button>
                </p>
              )}
              <div class={styles.actions}>
                <Button
                  htmlElement="button"
                  type="button"
                  variant="primary"
                  data-focus="confirm"
                  onClick={confirm}
                  disabled={zoomTooFar || checking}
                  aria-describedby={zoomTooFar ? ids.zoomNotice : undefined}
                >
                  {checking ? "Checking…" : "Use this location"}
                </Button>
                {hasLocation && (
                  <Button
                    htmlElement="button"
                    type="button"
                    variant="secondary"
                    onClick={cancelMoving}
                  >
                    Cancel
                  </Button>
                )}
                {move && !move.unmoved && (
                  <button type="button" class={styles.linkButton} onClick={resetToOriginal}>
                    Reset to original location
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div class={styles.panel}>
          <p class={styles.hint}>
            {lockedMove && !lockedMove.unmoved
              ? `${lockedMove.label} from the saved location.`
              : mode === "add"
                ? "The pin is on the toilet."
                : "This is where the toilet is on the map."}
          </p>
          <div class={styles.actions}>
            <Button
              htmlElement="button"
              type="button"
              variant="secondary"
              data-focus="movePin"
              onClick={() => startMoving("map")}
            >
              Move pin
            </Button>
            {showLockedReset && (
              <button type="button" class={styles.linkButton} onClick={resetToOriginal}>
                Reset to original location
              </button>
            )}
          </div>
        </div>
      )}

      <details class={styles.coords}>
        <summary class={styles.coordsSummary}>Enter coordinates</summary>
        <div class={styles.coordsBody}>
          <label class={styles.label} for={ids.coords}>
            Latitude, longitude
          </label>
          <p id={ids.coordsHint} class={styles.hint}>
            For example 51.5034, -0.1276. You can also paste a Google Maps link.
          </p>
          <div class={styles.coordsRow}>
            <InputField
              id={ids.coords}
              type="text"
              class={styles.input}
              autoComplete="off"
              spellcheck={false}
              value={coordText}
              aria-invalid={coordError ? "true" : undefined}
              aria-describedby={
                coordError ? `${ids.coordsError} ${ids.coordsHint}` : ids.coordsHint
              }
              onInput={(e) => {
                coordDirtyRef.current = true;
                setCoordText((e.target as HTMLInputElement).value);
                if (coordError) setCoordError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // never submit the surrounding form from here
                  showCoordinates();
                }
              }}
            />
            <Button
              htmlElement="button"
              type="button"
              variant="secondary"
              onClick={showCoordinates}
            >
              Show on map
            </Button>
          </div>
          {coordError && (
            <p id={ids.coordsError} class={styles.error} role="alert">
              {coordError}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
