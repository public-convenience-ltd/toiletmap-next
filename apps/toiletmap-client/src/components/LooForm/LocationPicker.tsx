import L from "leaflet";
import type { RefObject } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, InputField, Notice } from "toiletmap-design-system";
import { useNominatimSearch } from "../../hooks/useNominatimSearch";
import { BRAND_PINK, getIconString, makeIcon, PIN_PATH } from "../LooMap/looIcon";
import {
  addFormView,
  addToiletHref,
  DEFAULT_MAP_VIEW,
  type MapView,
  mapViewFromSearch,
  PIN_PLACE_ZOOM,
  readMapView,
  toMapView,
} from "../LooMap/mapView";
import { distanceMeters, isValidLatLng, type LatLng } from "./geometry";
import { formatCoordinates, isInUk, parseCoordinates } from "./LocationPicker/coordinates";
import styles from "./LocationPicker/LocationPicker.module.css";
import {
  describeMove,
  formatDistance,
  type MoveSummary,
  NOT_MOVED_METERS,
} from "./LocationPicker/move";
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

/** The picker never keeps a location from further out than this: the pin must be accurate. */
export const MIN_CONFIRM_ZOOM = PIN_PLACE_ZOOM;
/** Zoom used for the locked preview of a placed pin. */
const PLACED_ZOOM = 17;
/** Zoom "Use my location" and "Enter coordinates" go to (at least). */
const FOCUS_ZOOM = 18;
const NEARBY_DEBOUNCE_MS = 400;
/** A device fix less accurate than this (metres) never places the pin by itself. */
const APPROXIMATE_FIX_METERS = 50;
/** After "Zoom in", the same button ignores presses for this long, so a double tap can't confirm. */
export const ZOOM_IN_GUARD_MS = 500;
/** How long the "Locked to stop accidental moves" message stays on the map. */
const LOCKED_MESSAGE_MS = 4000;
/** A pointer that travels further than this (px) is a drag, not a tap. */
const DRAG_THRESHOLD_PX = 6;

export const ZOOM_IN_MESSAGE = "Zoom in closer to place the pin accurately";
export const BIG_MOVE_WARNING = "That's a big move — are you sure this is the same toilet?";
/** Under the big-move warning: how to answer it (Save is blocked until then). */
export const BIG_MOVE_HINT = "Confirm it with “Use this location”, or cancel it.";
export const LOCKED_MESSAGE =
  "Locked to stop accidental moves. Choose Move pin to change the location.";
/**
 * The one-time intro, on the edit form only (adding works as it always has): what's new, in
 * words that agree with the locked strip under the map.
 */
export const INTRO_MESSAGE =
  "To change where this toilet is, choose Move pin first, then move the map.";
/** localStorage key remembering that the one-time intro banner was dismissed. */
export const INTRO_STORAGE_KEY = "toiletmap-picker-intro-dismissed";

/** A mouse (or trackpad) is the main pointer: dragging the locked map unlocks it. */
const DESKTOP_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/** Leaflet's interaction handlers: all off for the locked preview, all on while moving. */
const INTERACTION_HANDLERS = [
  "dragging",
  "touchZoom",
  "scrollWheelZoom",
  "doubleClickZoom",
  "boxZoom",
  "keyboard",
] as const;

/** The centre pin while the map is too far out to place it: an outline, not the solid pin. */
const HOLLOW_PIN_SVG = `<svg viewBox="-1 -1 21 33" height="33" width="21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="${PIN_PATH}" fill="white" fill-opacity="0.85" stroke="${BRAND_PINK}" stroke-width="2" stroke-dasharray="3 2"/><circle cx="10" cy="10" r="4" fill="none" stroke="${BRAND_PINK}" stroke-width="1.5"/></svg>`;

const LockIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1.5 1.5 0 0 1 13.5 8.5v5A1.5 1.5 0 0 1 12 15H4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4 7h.5Zm1.5 0h4V5a2 2 0 0 0-4 0v2Z"
      fill="currentColor"
    />
  </svg>
);

type Phase = "locked" | "moving";
type FocusTarget = "map" | "confirm" | "movePin" | "prompt" | null;
type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "error"; message: string }
  | { kind: "approximate"; message: string };

/** What moved the map last: the user, or the picker itself (and why). */
type MoveSource =
  | "user"
  | "sync"
  | "reset"
  | "zoom"
  | "search"
  | "gps"
  | "gpsApprox"
  | "coords"
  /** Putting the centre back after the map was resized (a phone rotated, a window resized). */
  | "resize";
/** A jump the picker made for the user: search, "Use my location" or typed coordinates. */
export type JumpKind = "search" | "gps" | "coords";
/** How a new toilet's pin was placed (add flow). */
type Placement = "pan" | JumpKind;

/** Why the picker can't keep the pin where it is without the user answering something. */
export type PickerIssue = "zoom" | "bigMove" | "jump" | "duplicate";

/** How a location reached the form: confirmed, kept automatically on moving on, or reset. */
export type LocationChangeSource = "confirmed" | "auto" | "reset";

/** The spot the pin is on while moving, not yet kept. */
export interface PendingLocation {
  location: LatLng;
  /** True when moving on (or saving) would keep it with no question asked. */
  keepable: boolean;
  issue: PickerIssue | null;
  /**
   * The duplicate check has been done for this spot (no match, or the user said it's a
   * different toilet), or it doesn't need one. Only a checked spot may be put in a draft: a
   * restored draft's location is not checked again.
   */
  checked: boolean;
}

export type PickerResolution =
  /** The form's location is settled: `location` is what it is now (null: no pin at all). */
  | { kind: "ok"; location: LatLng | null; source: LocationChangeSource | null }
  /**
   * The pin can't be kept yet: the user has to answer `issue` (`name`: the possible duplicate;
   * `jump`: what moved the map, for a jump while editing).
   */
  | { kind: "blocked"; issue: PickerIssue; name?: string; jump?: JumpKind }
  /**
   * A new toilet whose pin isn't placed: the map is where it opened, or (`accuracy`, in metres)
   * at a rough "Use my location" fix.
   */
  | { kind: "unplaced"; accuracy?: number };

export interface ResolveOptions {
  /** Resolving for Save, which checks a kept move itself (see LocationPickerHandle.resolve). */
  save?: boolean;
}

/** What the form can ask of the picker (LooForm holds it in a ref). */
export interface LocationPickerHandle {
  /**
   * Keep a pending move if it is safe to, or say what blocks it. Moving on to another question
   * resolves without options. Save passes `save: true`: a jump to typed coordinates or the
   * device's position is then kept too (the form asks "Save the new location?" about it, as
   * it does for a dragged move), where moving on leaves it for "Use this location". A search
   * jump, a big move, too little zoom and a duplicate question still block.
   */
  resolve: (options?: ResolveOptions) => Promise<PickerResolution>;
  /** "Yes, it's on the toilet": keep a never-moved pin where the map opened. */
  placeHere: () => LatLng | null;
  /** Put focus on the map, moving if needed ("Move the map"). */
  focusMap: () => void;
  /** Take the user to (or fix) what blocks keeping the pin: the error summary's link. */
  fixIssue: (issue: PickerIssue) => void;
}

export interface LocationPickerProps {
  /** Current pin position, or null when no pin has been placed yet. */
  location: LatLng | null;
  /**
   * The saved location when editing an existing toilet: shown as a grey "ghost" pin while
   * moving, measured from by the "Moved 23 m north-east" chip, and restorable with
   * "Reset to original location".
   */
  originalLocation?: LatLng | null;
  /**
   * Called when a location is kept: confirmed ("Use this location"), kept automatically when
   * the user carries on with the form or saves, or reset to the original.
   */
  onChange: (lat: number, lng: number, source?: LocationChangeSource) => void;
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
  /** Told about the spot the pin is on while moving and not yet kept (null: nothing pending). */
  onPendingChange?: (pending: PendingLocation | null) => void;
  /** Told what would stop the pin being kept where the map is now (null: nothing). */
  onIssueChange?: (issue: PickerIssue | null) => void;
  /** Filled with the picker's handle, so the form can ask it to settle before saving. */
  controllerRef?: RefObject<LocationPickerHandle | null>;
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
  const fromUrl =
    !given && mode === "add" && typeof window !== "undefined"
      ? mapViewFromSearch(window.location.search)
      : null;
  // The opening view is never a placed pin, wherever it came from (the "Add a toilet here"
  // link carries the live map view): it only decides where the user starts looking.
  return addFormView(given ?? fromUrl ?? readMapView() ?? DEFAULT_MAP_VIEW);
}

function setInteractive(map: L.Map, on: boolean, el: HTMLElement | null) {
  for (const name of INTERACTION_HANDLERS) {
    const handler = map[name] as L.Handler | undefined;
    if (!handler) continue;
    if (on) handler.enable();
    else handler.disable();
  }
  // Leaflet's keyboard handler makes the container a Tab stop (tabIndex 0) when it starts, and
  // never undoes it: the locked preview, whose arrow keys do nothing, must not be one.
  if (el) el.tabIndex = on ? 0 : -1;
}

const isDesktopPointer = () => {
  try {
    return typeof window.matchMedia === "function"
      ? window.matchMedia(DESKTOP_POINTER_QUERY).matches
      : false;
  } catch {
    return false;
  }
};

const readIntroDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(INTRO_STORAGE_KEY) === "1";
  } catch {
    return false; // storage blocked: show the banner, it can still be dismissed for this page
  }
};

const rememberIntroDismissed = () => {
  try {
    window.localStorage.setItem(INTRO_STORAGE_KEY, "1");
  } catch {
    // Storage full or disabled: it is only hidden for this page.
  }
};

const geolocationErrorMessage = (error: GeolocationPositionError | { code?: number }) =>
  error.code === 1
    ? "Location access is blocked. Allow it in your browser settings, or move the map to the toilet."
    : "We couldn't find your location. Move the map to the toilet instead.";

/** The name a duplicate question uses for the toilet it asks about. */
const matchName = (match: NearbyMatch) =>
  match.kind === "active" ? (match.loo.name ?? "an unnamed toilet") : "the removed toilet nearby";

type Candidate =
  /** The centre is where the form's location already is: nothing new to keep. */
  | { kind: "same" }
  /** A new toilet whose pin hasn't been placed: the map is where it opened. */
  | { kind: "unplaced" }
  /** A new spot, kept when moving on unless `issue` says why not. */
  | { kind: "move"; move: MoveSummary | null; issue: PickerIssue | null };

/** What stops keeping the pin for `candidate` at `zoom` (an unplaced pin can still be blocked). */
const candidateIssue = (candidate: Candidate, zoom: number, promptOpen: boolean) =>
  candidate.kind === "move"
    ? candidate.issue
    : candidate.kind === "unplaced"
      ? zoom < MIN_CONFIRM_ZOOM
        ? "zoom"
        : promptOpen
          ? "duplicate"
          : null
      : null;

/** What keeping the pin at `at` would mean (pure, so render and async code agree). */
function assessCandidate(args: {
  at: LatLng;
  zoom: number;
  current: LatLng | null;
  original: LatLng | null;
  placed: boolean;
  jump: boolean;
  promptOpen: boolean;
  /** Adding: the map is at a rough device fix, which never places the pin by itself. */
  approximate?: boolean;
}): Candidate {
  const { at, zoom, current, original, placed, jump, promptOpen, approximate = false } = args;
  if (current && distanceMeters(current, at) <= NOT_MOVED_METERS) return { kind: "same" };
  // A rough fix leaves the pin not placed, even where an earlier spot was kept: keeping it
  // would put the toilet wherever the device guessed.
  if (!original && (approximate || (!current && !placed))) return { kind: "unplaced" };
  const move = original ? describeMove(original, at) : null;
  // Back at the saved location is always safe to keep, at any zoom.
  const issue: PickerIssue | null = move?.unmoved
    ? null
    : zoom < MIN_CONFIRM_ZOOM
      ? "zoom"
      : move?.big
        ? "bigMove"
        : original && jump && !move?.unmoved
          ? "jump"
          : promptOpen
            ? "duplicate"
            : null;
  return { kind: "move", move, issue };
}

/**
 * Where the toilet is. The pin is the centre of the map: move the map until it is on the toilet
 * and carry on with the form. The move is kept (and the map locked, so scrolling the page can't
 * move it) when the user goes on to another question or saves, unless it needs an answer first:
 * a big move, a search jump while editing, a possible duplicate, or a map zoomed out too far.
 * Editing opens locked; "Move pin" (or, with a mouse, dragging the map) unlocks it. A tap on the
 * map never moves anything.
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
  onPendingChange,
  onIssueChange,
  controllerRef,
}: LocationPickerProps) {
  const uid = useId();
  const ids = {
    search: `${uid}-search`,
    searchStatus: `${uid}-search-status`,
    coords: `${uid}-coords`,
    coordsHint: `${uid}-coords-hint`,
    coordsError: `${uid}-coords-error`,
    strip: `${uid}-strip`,
    prompt: `${uid}-prompt`,
  };

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinRef = useRef<L.Marker | null>(null);
  const ghostRef = useRef<L.Marker | null>(null);
  const nearbyLayerRef = useRef<L.LayerGroup | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<FocusTarget>(null);

  // Latest props for Leaflet handlers and async callbacks, which outlive a render.
  const latest = useRef({ location, originalLocation, onChange, apiUrl, excludeId, mode });
  latest.current = { location, originalLocation, onChange, apiUrl, excludeId, mode };
  /** A location kept since the last render (the prop catches up on the next one). */
  const committedRef = useRef<LatLng | null | undefined>(undefined);
  committedRef.current = undefined;
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const onMovingChangeRef = useRef(onMovingChange);
  onMovingChangeRef.current = onMovingChange;
  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;
  const onIssueChangeRef = useRef(onIssueChange);
  onIssueChangeRef.current = onIssueChange;

  const [phase, setPhase] = useState<Phase>(() =>
    hasValidLocation(location) ? "locked" : "moving",
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const setPhaseNow = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // The map's live centre and zoom (the pin, while moving, is the centre)…
  const [centre, setCentre] = useState<LatLng | null>(null);
  const [zoom, setZoom] = useState<number>(0);
  // …and where it last came to rest.
  const [settled, setSettled] = useState<{ centre: LatLng; zoom: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /** A new toilet's pin has been placed (by panning, or a search / location / coordinates). */
  const [placedBy, setPlacedByState] = useState<Placement | null>(null);
  const placedByRef = useRef(placedBy);
  placedByRef.current = placedBy;
  const setPlacedBy = (next: Placement | null) => {
    placedByRef.current = next;
    setPlacedByState(next);
  };
  /** Editing: the map jumped to a search result, the device's location or typed coordinates. */
  const [jump, setJumpState] = useState<JumpKind | null>(null);
  const jumpRef = useRef(jump);
  jumpRef.current = jump;
  const setJump = (next: JumpKind | null) => {
    jumpRef.current = next;
    setJumpState(next);
  };
  /**
   * Adding: the map is at a "Use my location" fix worse than 50 m (its accuracy, in metres).
   * The pin is not placed until the user pans, searches or confirms, whatever was kept before.
   */
  const [approximate, setApproximateState] = useState<number | null>(null);
  const approximateRef = useRef(approximate);
  approximateRef.current = approximate;
  const setApproximate = (next: number | null) => {
    approximateRef.current = next;
    setApproximateState(next);
  };
  /** Where the duplicate check last came back clear (or was answered "a different toilet"). */
  const [checkedAt, setCheckedAt] = useState<LatLng | null>(null);

  const moveSourceRef = useRef<MoveSource | null>(null);
  /** The centre at the last moveend: a later moveend further away than 0.5 m was a pan. */
  const lastSettledRef = useRef<LatLng | null>(null);
  /** The user has panned since the map opened (add flow: a pan at zoom < 17 still counts). */
  const movedByUserRef = useRef(false);
  /** "Zoom in" was just pressed: the same button ignores presses until then. */
  const guardUntilRef = useRef(0);
  /** Toilets the user said are not this one ("No, this is a different toilet"). */
  const dismissedRef = useRef(new Set<string>());
  const keepInFlightRef = useRef<Promise<PickerResolution> | null>(null);
  const lastPendingRef = useRef("");
  const lastIssueRef = useRef<PickerIssue | null>(null);
  /** A mouse drag on the locked map is in progress: its moves settle once, when it ends. */
  const mouseDragRef = useRef(false);
  /** Leaflet's own drag is in progress (a resize then leaves the centre alone). */
  const leafletDragRef = useRef(false);
  /** The map's top on screen before Move pin, so the toolbar appearing above can't push it down. */
  const anchorTopRef = useRef<number | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const nearbyRef = useRef<{ centre: LatLng; loos: NearbyLoo[] } | null>(null);
  const [nearbyCount, setNearbyCount] = useState(0);
  const nearbyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyAbortRef = useRef<AbortController | null>(null);

  const [checking, setChecking] = useState(false);
  /** The duplicate question. `explicit`: asked after "Use this location", so "No" keeps the pin. */
  const [prompt, setPromptState] = useState<{
    match: NearbyMatch;
    target: LatLng;
    explicit: boolean;
  } | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const setPrompt = (next: typeof prompt) => {
    promptRef.current = next;
    setPromptState(next);
  };
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });

  const [lockedMessage, setLockedMessage] = useState(false);
  const lockedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [introVisible, setIntroVisible] = useState(() => !readIntroDismissed());

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

  const original = hasValidLocation(originalLocation) ? originalLocation : null;
  /** A new toilet, or one with no location yet: the pin starts "not placed". */
  const addFlow = !original;

  /** The location the form holds now, including a keep made since the last render. */
  const currentLocation = (): LatLng | null => {
    const value =
      committedRef.current !== undefined ? committedRef.current : latest.current.location;
    return hasValidLocation(value) ? value : null;
  };
  const originalNow = (): LatLng | null => {
    const value = latest.current.originalLocation;
    return hasValidLocation(value) ? value : null;
  };

  /** Run a programmatic map move, so the moveend it fires is not mistaken for a pan. */
  const moveMap = (source: MoveSource, fn: () => void) => {
    const previous = moveSourceRef.current;
    moveSourceRef.current = source;
    try {
      fn();
    } finally {
      moveSourceRef.current = previous;
    }
  };

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

  /** The toilet the pin at `target` may be a duplicate of (never one the user said isn't). */
  const matchAt = (target: LatLng, nearby: NearbyLoo[]): NearbyMatch | null => {
    const saved = originalNow();
    return findNearbyMatch(
      target,
      nearby.filter((loo) => !dismissedRef.current.has(loo.id)),
      latest.current.excludeId,
      undefined,
      // Editing: only a toilet the pin was moved towards, and never a removed one ("Restore it"
      // is for someone adding a toilet that used to be there).
      { original: saved, includeRemoved: latest.current.mode !== "edit" },
    );
  };

  /** Whether a pin at `target` needs a duplicate check (not when editing and still unmoved). */
  const needsCheck = (target: LatLng) => {
    const saved = originalNow();
    return !saved || distanceMeters(saved, target) > NOT_MOVED_METERS;
  };

  const showPrompt = (match: NearbyMatch, target: LatLng, explicit: boolean) => {
    setPrompt({ match, target, explicit });
    setAnnouncement(
      match.kind === "active"
        ? `Is it the same toilet? ${matchName(match)} is already on the map, ${formatDistance(match.distance)} away.`
        : `Is it the same toilet? A removed toilet was recorded ${formatDistance(match.distance)} away.`,
    );
  };

  /** Look up the toilets around the map centre (and check for a duplicate) once it settles. */
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
      const at = toLatLng(map.getCenter());
      const loos = await fetchNearby(at, controller.signal);
      if (controller.signal.aborted || phaseRef.current !== "moving") return;
      if (nearbyAbortRef.current === controller) nearbyAbortRef.current = null;
      if (!loos) return;
      drawNearby(loos);
      // The duplicate check runs each time the map stops at zoom 17 or closer.
      if (map.getZoom() < MIN_CONFIRM_ZOOM || promptRef.current || !needsCheck(at)) return;
      if (distanceMeters(toLatLng(map.getCenter()), at) > NOT_MOVED_METERS) return;
      const match = matchAt(at, loos);
      if (!match) {
        setCheckedAt(at);
        return;
      }
      // The question replaces the buttons under the map: if one of them has focus (a keyboard
      // user tabbed to "Use this location"), move it to the question instead of losing it.
      const active = typeof document === "undefined" ? null : document.activeElement;
      if (active && actionsRef.current?.contains(active)) pendingFocusRef.current = "prompt";
      showPrompt(match, at, false);
    }, NEARBY_DEBOUNCE_MS);
  };

  // ── Map setup ────────────────────────────────────────────────

  /** A moveend while moving: was it a pan, a jump, or only a zoom? */
  const onSettle = (source: MoveSource, panned: boolean, z: number) => {
    const isAdd = !originalNow();
    if (source === "user" && panned) {
      movedByUserRef.current = true;
      if (approximateRef.current !== null) setApproximate(null);
      // A nudge after a jump means the user has looked at where the pin is.
      if (jumpRef.current) setJump(null);
    } else if (source === "search" || source === "gps" || source === "coords") {
      if (approximateRef.current !== null) setApproximate(null);
      if (isAdd) {
        movedByUserRef.current = true;
        if (z >= MIN_CONFIRM_ZOOM) {
          setPlacedBy(source);
          return;
        }
      } else {
        setJump(source);
      }
      return;
    } else if (source === "gpsApprox") {
      // Too rough to place a new toilet's pin: it is somewhere near, not placed (`approximate`
      // was set as the map moved, so even a pin kept earlier isn't replaced by this spot).
      movedByUserRef.current = false;
      setPlacedBy(null);
      return;
    }
    if (!isAdd) {
      const saved = originalNow();
      const map = mapRef.current;
      if (source === "user" && panned && saved && map) {
        const move = describeMove(saved, toLatLng(map.getCenter()));
        if (!move.unmoved) {
          setAnnouncement(
            move.big
              ? `${move.label}. A move this big is only kept with Use this location.`
              : `${move.label}. This is kept when you carry on with the form.`,
          );
        }
      }
      return;
    }
    // Add flow: a pan (now or earlier) places the pin once the map stops at zoom 17 or closer.
    // Zooming alone never does: it zooms around the centre.
    if (!movedByUserRef.current || z < MIN_CONFIRM_ZOOM) return;
    if (!placedByRef.current) {
      setPlacedBy("pan");
      setAnnouncement("Pin placed.");
    } else if (source === "user" && panned) {
      setPlacedBy("pan"); // adjusted by hand after a search: say so
    }
  };

  useLayoutEffect(() => {
    if (!container.current || mapRef.current) return;
    const start = hasValidLocation(location)
      ? { lat: location.lat, lng: location.lng, zoom: PLACED_ZOOM }
      : resolveStartView(mode, initialView);
    const map = L.map(container.current, {
      zoomControl: false,
      // Zooming (wheel, double-click, pinch, +/-) always keeps the centre, so it never moves the pin.
      scrollWheelZoom: "center",
      doubleClickZoom: "center",
      touchZoom: "center",
    }).setView([start.lat, start.lng], start.zoom);
    mapRef.current = map;
    setInteractive(map, phaseRef.current === "moving", container.current);

    // A resize (a phone rotated, a window or split screen resized) keeps the centre only to the
    // nearest pixel: Leaflet rounds half the map's size, which at zoom 14 is metres. Put the
    // exact centre back, so a resize is never taken for a pan (placing a new toilet's pin, or
    // "moving" an edited one by under a metre).
    if (typeof map.invalidateSize === "function") {
      const invalidateSize = map.invalidateSize.bind(map);
      map.invalidateSize = ((options?: Parameters<L.Map["invalidateSize"]>[0]) => {
        const before = map.getCenter();
        invalidateSize(options);
        const after = map.getCenter();
        // Not mid-drag or mid-zoom: resetting the view then would cut the gesture short.
        const busy =
          leafletDragRef.current || (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
        if (!busy && (after.lat !== before.lat || after.lng !== before.lng)) {
          // `reset` (not in Leaflet's types) sets the view exactly: a plain setView would round
          // the shift to whole pixels, which is the problem being undone.
          const exactly = { reset: true, pan: { noMoveStart: true } } as L.ZoomPanOptions;
          moveMap("resize", () => map.setView(before, map.getZoom(), exactly));
        }
        return map;
      }) as L.Map["invalidateSize"];
    }
    L.control.zoom({ position: "topright" }).addTo(map);
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
      if (moveSourceRef.current === "resize") return; // the map didn't really move
      setPrompt(null);
      dismissSearchRef.current();
    });
    map.on("dragstart", () => {
      leafletDragRef.current = true;
    });
    map.on("dragend", () => {
      leafletDragRef.current = false;
    });
    map.on("moveend", () => {
      syncView();
      // Mid mouse drag (unlocking the locked map): it settles once, when the button comes up.
      if (mouseDragRef.current) return;
      const at = toLatLng(map.getCenter());
      const z = map.getZoom();
      const last = lastSettledRef.current;
      const panned = !last || distanceMeters(last, at) > NOT_MOVED_METERS;
      lastSettledRef.current = at;
      if (phaseRef.current === "moving") onSettle(moveSourceRef.current ?? "user", panned, z);
      setSettled({ centre: at, zoom: z });
      scheduleNearby();
    });
    syncView();
    const at = toLatLng(map.getCenter());
    lastSettledRef.current = at;
    setSettled({ centre: at, zoom: map.getZoom() });
    onMapReadyRef.current?.(map);
    return () => {
      onMapReadyRef.current?.(null);
      if (nearbyTimerRef.current) clearTimeout(nearbyTimerRef.current);
      if (lockedTimerRef.current) clearTimeout(lockedTimerRef.current);
      nearbyAbortRef.current?.abort();
      map.remove();
      mapRef.current = null;
      pinRef.current = null;
      ghostRef.current = null;
      nearbyLayerRef.current = null;
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
    setInteractive(map, moving, container.current);
    if (moving) {
      scheduleNearby();
    } else {
      clearNearby();
      setGeo({ kind: "idle" });
    }
    onMovingChangeRef.current?.(moving);
  }, [phase]);

  // The locked pin follows the kept location; the view re-centres on it.
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
      moveMap("sync", () =>
        map.setView(at, Math.max(map.getZoom(), PLACED_ZOOM), { animate: false }),
      );
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

  // Re-sync the coordinate box only when the location changed for another reason (a kept
  // move, a reset, a rebase), never over text the user is still typing.
  useEffect(() => {
    if (coordDirtyRef.current) return;
    setCoordText(formatCoordinates(hasValidLocation(location) ? location : null));
    setCoordError(null);
  }, [location?.lat, location?.lng]);

  // Move focus where an action said it should go, as soon as the DOM has caught up.
  useLayoutEffect(() => {
    const anchorTop = anchorTopRef.current;
    anchorTopRef.current = null;
    const target = pendingFocusRef.current;
    if (target) {
      pendingFocusRef.current = null;
      const el =
        target === "map"
          ? container.current
          : rootRef.current?.querySelector<HTMLElement>(`[data-focus="${target}"]`);
      el?.focus(anchorTop !== null ? { preventScroll: true } : undefined);
    }
    // Move pin adds the search box above the map: scroll by as much, so the map stays under the
    // user's finger (WebKit has no scroll anchoring; where the browser already kept it in
    // place, there is nothing left to do).
    const box = anchorTop !== null ? container.current?.getBoundingClientRect() : null;
    if (box && anchorTop !== null) {
      const shift = box.top - anchorTop;
      if (Math.abs(shift) >= 1 && typeof window.scrollBy === "function") window.scrollBy(0, shift);
    }
  });

  // Tell the form about the spot the pin is on while it isn't kept yet: it counts as a change.
  useEffect(() => {
    const report = onPendingChangeRef.current;
    let pending: PendingLocation | null = null;
    let issue: PickerIssue | null = null;
    if (phase === "moving" && settled) {
      const candidate = assessCandidate({
        at: settled.centre,
        zoom: settled.zoom,
        current: hasValidLocation(location) ? location : null,
        original,
        placed: placedBy !== null,
        jump: jump !== null,
        promptOpen: prompt !== null,
        approximate: approximate !== null,
      });
      issue = candidateIssue(candidate, settled.zoom, prompt !== null);
      if (candidate.kind === "move") {
        const checked =
          !needsCheck(settled.centre) ||
          (!!checkedAt && distanceMeters(checkedAt, settled.centre) <= NOT_MOVED_METERS);
        pending = {
          location: { lat: round6(settled.centre.lat), lng: round6(settled.centre.lng) },
          keepable: candidate.issue === null,
          issue: candidate.issue,
          checked,
        };
      }
    }
    if (issue !== lastIssueRef.current) {
      lastIssueRef.current = issue;
      onIssueChangeRef.current?.(issue);
    }
    if (!report) return;
    const key = JSON.stringify(pending);
    if (key === lastPendingRef.current) return;
    lastPendingRef.current = key;
    report(pending);
  }, [
    phase,
    settled,
    placedBy,
    jump,
    prompt,
    approximate,
    checkedAt,
    location?.lat,
    location?.lng,
    original?.lat,
    original?.lng,
  ]);

  // ── Actions ──────────────────────────────────────────────────

  const showLockedMessage = () => {
    setLockedMessage(true);
    setAnnouncement(LOCKED_MESSAGE);
    if (lockedTimerRef.current) clearTimeout(lockedTimerRef.current);
    lockedTimerRef.current = setTimeout(() => {
      lockedTimerRef.current = null;
      setLockedMessage(false);
    }, LOCKED_MESSAGE_MS);
  };

  const startMoving = (
    focus: FocusTarget = "map",
    { anchor = false }: { anchor?: boolean } = {},
  ) => {
    setPrompt(null);
    setLockedMessage(false);
    setApproximate(null);
    pendingFocusRef.current = focus;
    movedByUserRef.current = false;
    if (anchor) anchorTopRef.current = container.current?.getBoundingClientRect().top ?? null;
    const map = mapRef.current;
    if (map) lastSettledRef.current = toLatLng(map.getCenter());
    setAnnouncement(
      "Move the map until the pin in the centre is on the toilet. The move is kept when you carry on with the form.",
    );
    setPhaseNow("moving");
  };

  const finishMoving = ({ focus = true }: { focus?: boolean } = {}) => {
    setPrompt(null);
    setChecking(false);
    setJump(null);
    setApproximate(null);
    if (focus) pendingFocusRef.current = "movePin";
    setPhaseNow("locked");
  };

  const cancelMoving = () => {
    // Nothing was sent to the form while moving: the pin is still where it was.
    setAnnouncement("Move cancelled. The pin is where it was.");
    finishMoving();
  };

  /**
   * Keep `target` in the form (exactly the original if it is back there) and lock the map.
   * Returns the location the form holds afterwards.
   */
  const commit = (
    target: LatLng,
    source: LocationChangeSource,
    { focus = true }: { focus?: boolean } = {},
  ): LatLng | null => {
    const current = currentLocation();
    const saved = originalNow();
    const emit = latest.current.onChange;
    let result = current;
    if (saved && distanceMeters(saved, target) <= NOT_MOVED_METERS) {
      if (!current || current.lat !== saved.lat || current.lng !== saved.lng) {
        emit(saved.lat, saved.lng, source); // unrounded, so the form sees no change at all
      }
      result = saved;
    } else if (!current || distanceMeters(current, target) > NOT_MOVED_METERS) {
      result = { lat: round6(target.lat), lng: round6(target.lng) };
      emit(result.lat, result.lng, source);
    }
    committedRef.current = result;
    if (source === "auto") {
      const move = saved && result ? describeMove(saved, result) : null;
      setAnnouncement(
        move
          ? move.unmoved
            ? "The pin is at the saved location. Locked again."
            : `${move.label} from the saved location. Locked again.`
          : "Pin placed and locked.",
      );
    } else {
      setAnnouncement("Location set.");
    }
    finishMoving({ focus });
    return result;
  };

  /**
   * Keep the pending move if it is safe to (the user carried on with the form, or pressed
   * Save), or say what needs answering first. Never keeps anything below zoom 17, a big move,
   * an unchecked jump while editing, or a pin with an open (or new) duplicate question.
   */
  const keep = async ({ save = false }: ResolveOptions = {}): Promise<PickerResolution> => {
    const map = mapRef.current;
    if (!map || phaseRef.current !== "moving") {
      return { kind: "ok", location: currentLocation(), source: null };
    }
    const target = toLatLng(map.getCenter());
    const z = map.getZoom();
    const candidate = assessCandidate({
      at: target,
      zoom: z,
      current: currentLocation(),
      original: originalNow(),
      placed: placedByRef.current !== null,
      jump: jumpRef.current !== null,
      promptOpen: promptRef.current !== null,
      approximate: approximateRef.current !== null,
    });
    if (candidate.kind === "same") {
      finishMoving({ focus: false });
      return { kind: "ok", location: currentLocation(), source: null };
    }
    if (candidate.kind === "move" && candidate.move?.unmoved) {
      // Back where it was saved: nothing to check, keep exactly the original.
      return { kind: "ok", location: commit(target, "auto", { focus: false }), source: "auto" };
    }
    if (z < MIN_CONFIRM_ZOOM) return { kind: "blocked", issue: "zoom" };
    if (candidate.kind === "move" && candidate.issue && candidate.issue !== "duplicate") {
      const jump = jumpRef.current;
      // Saving: typed coordinates or the device's position are kept for the form's own check.
      const saveChecksIt = save && candidate.issue === "jump" && !!jump && jump !== "search";
      if (!saveChecksIt) {
        return candidate.issue === "jump" && jump
          ? { kind: "blocked", issue: "jump", jump }
          : { kind: "blocked", issue: candidate.issue };
      }
    }
    const open = promptRef.current;
    if (open) return { kind: "blocked", issue: "duplicate", name: matchName(open.match) };
    if (needsCheck(target)) {
      const nearby = await nearbyFor(target);
      if (mapRef.current !== map) return { kind: "ok", location: currentLocation(), source: null };
      if (phaseRef.current !== "moving") {
        return { kind: "ok", location: currentLocation(), source: null };
      }
      // The map moved while we looked: start again from where it is now.
      if (distanceMeters(toLatLng(map.getCenter()), target) > NOT_MOVED_METERS) {
        return keep({ save });
      }
      const asked = promptRef.current;
      if (asked) return { kind: "blocked", issue: "duplicate", name: matchName(asked.match) };
      const match = matchAt(target, nearby);
      if (match) {
        showPrompt(match, target, false);
        return { kind: "blocked", issue: "duplicate", name: matchName(match) };
      }
    }
    if (candidate.kind === "unplaced") {
      const accuracy = approximateRef.current;
      return accuracy !== null ? { kind: "unplaced", accuracy } : { kind: "unplaced" };
    }
    const kept = commit(target, "auto", { focus: false });
    return { kind: "ok", location: kept, source: "auto" };
  };

  /** One keep at a time: moving on and pressing Save often happen together. */
  const keepOnce = (options: ResolveOptions = {}): Promise<PickerResolution> => {
    const inFlight = keepInFlightRef.current;
    if (inFlight) {
      // Save pressed while moving on was still keeping: a jump that blocked that keep is
      // Save's to check, so ask again for Save.
      if (!options.save) return inFlight;
      return inFlight.then((result) =>
        result.kind === "blocked" && result.issue === "jump" ? keepOnce(options) : result,
      );
    }
    const next = keep(options).finally(() => {
      if (keepInFlightRef.current === next) keepInFlightRef.current = null;
    });
    keepInFlightRef.current = next;
    return next;
  };

  // Moving on to another question (focus or a click outside the picker) keeps a safe move.
  useEffect(() => {
    if (phase !== "moving") return;
    // Outside the picker, and not around it either: WebKit focuses the nearest focusable
    // ancestor (the question's wrapper) when a button inside the picker is tapped.
    const outside = (target: EventTarget | null) => {
      const root = rootRef.current;
      return target instanceof Node && !!root && !root.contains(target) && !target.contains(root);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) keepOnce();
    };
    const onClick = (event: MouseEvent) => {
      if (outside(event.target)) keepOnce();
    };
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [phase]);

  // Touching the locked map explains the lock. With a mouse, dragging it unlocks it and keeps
  // panning (as the old map did); a tap or click never moves anything.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let gesture: {
      id: number;
      x: number;
      y: number;
      lastX: number;
      lastY: number;
      mouse: boolean;
      moved: boolean;
      unlocked: boolean;
      warned: boolean;
    } | null = null;
    const onDown = (event: PointerEvent) => {
      if (phaseRef.current !== "locked" || event.button !== 0 || event.isPrimary === false) return;
      if (event.target instanceof Element && event.target.closest(".leaflet-control")) return;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        mouse: event.pointerType === "mouse" && isDesktopPointer(),
        moved: false,
        unlocked: false,
        warned: false,
      };
    };
    const onMove = (event: PointerEvent) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      if (g.mouse) {
        event.preventDefault(); // no text selection while dragging
        if (!g.unlocked) {
          g.unlocked = true;
          startMoving("map", { anchor: true });
        }
        const map = mapRef.current;
        // Each step fires a moveend: the drag settles once, when it ends (see finishDrag).
        mouseDragRef.current = true;
        map?.panBy([g.lastX - event.clientX, g.lastY - event.clientY], {
          animate: false,
          noMoveStart: true,
        });
        g.lastX = event.clientX;
        g.lastY = event.clientY;
      } else if (!g.warned && Math.abs(dx) > Math.abs(dy)) {
        // Sideways: an attempt to move the map (a vertical swipe scrolls the page instead).
        g.warned = true;
        showLockedMessage();
      }
    };
    /** The mouse drag that unlocked the map is over: it comes to rest, once. */
    const finishDrag = (g: NonNullable<typeof gesture>) => {
      if (!g.unlocked || !mouseDragRef.current) return;
      mouseDragRef.current = false;
      mapRef.current?.fire("moveend");
    };
    const onUp = (event: PointerEvent) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      gesture = null;
      if (!g.moved) showLockedMessage();
      finishDrag(g);
    };
    const onCancel = () => {
      const g = gesture;
      gesture = null; // the browser took over: the page is scrolling
      if (g) finishDrag(g);
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  const confirm = async () => {
    const map = mapRef.current;
    if (!map || checking) return;
    if (Date.now() < guardUntilRef.current) return; // just pressed as "Zoom in"
    if (map.getZoom() < MIN_CONFIRM_ZOOM) return;
    const target = toLatLng(map.getCenter());
    // Not moved at all: there is nothing new to check against.
    if (!needsCheck(target)) {
      commit(target, "confirmed");
      return;
    }
    setChecking(true);
    const nearby = await nearbyFor(target);
    setChecking(false);
    if (phaseRef.current !== "moving" || mapRef.current !== map) return;
    // The user moved on while we looked: they'll confirm again from the new spot.
    if (distanceMeters(toLatLng(map.getCenter()), target) > NOT_MOVED_METERS) return;
    const match = matchAt(target, nearby);
    if (match) {
      pendingFocusRef.current = "prompt";
      showPrompt(match, target, true);
      return;
    }
    commit(target, "confirmed");
  };

  /** "No, this is a different toilet": remembered for that toilet, never asked about again. */
  const notTheSame = () => {
    const open = promptRef.current;
    if (!open) return;
    dismissedRef.current.add(open.match.loo.id);
    if (open.explicit) {
      commit(open.target, "confirmed");
      return;
    }
    setCheckedAt(open.target);
    setPrompt(null);
    pendingFocusRef.current = "confirm";
    setAnnouncement("Noted: it's a different toilet.");
  };

  /** Put the pin back where it was saved, straight away, from either phase. */
  const resetToOriginal = () => {
    const map = mapRef.current;
    const saved = originalNow();
    const current = currentLocation();
    const emit = latest.current.onChange;
    if (!map || !saved) return;
    setPrompt(null);
    // Unrounded, so the form sees no location change at all.
    if (!current || current.lat !== saved.lat || current.lng !== saved.lng) {
      emit(saved.lat, saved.lng, "reset");
    }
    committedRef.current = saved;
    moveMap("reset", () =>
      map.setView([saved.lat, saved.lng], Math.max(map.getZoom(), PLACED_ZOOM), {
        animate: false,
      }),
    );
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
    guardUntilRef.current = Date.now() + ZOOM_IN_GUARD_MS;
    moveMap("zoom", () => map.setZoom(MIN_CONFIRM_ZOOM));
    pendingFocusRef.current = "confirm";
  };

  const selectSuggestion = (s: (typeof search.suggestions)[number]) => {
    setAnnouncement(`Map moved to ${s.display_name}.`);
    moveMap("search", () => search.handleSuggestionSelect(s));
    pendingFocusRef.current = "map";
    if (!originalNow() && placedByRef.current === "search") {
      setAnnouncement(`Pin placed at ${s.display_name}.`);
    }
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
          if (phaseRef.current !== "moving") startMoving(null);
          const approximate = Number.isFinite(accuracy) && accuracy > APPROXIMATE_FIX_METERS;
          const isAdd = !originalNow();
          // A rough fix never places a new toilet's pin, nor replaces one kept before.
          setApproximate(approximate && isAdd ? accuracy : null);
          moveMap(approximate && isAdd ? "gpsApprox" : "gps", () =>
            map.setView([latitude, longitude], Math.max(map.getZoom(), FOCUS_ZOOM), {
              animate: false,
            }),
          );
          setGeo(
            approximate
              ? {
                  kind: "approximate",
                  message: isAdd
                    ? `Your location is only accurate to about ${formatDistance(accuracy)}, so the pin isn't placed yet. Move the map until it's on the toilet.`
                    : `Your location is only accurate to about ${formatDistance(accuracy)}. Check the pin is on the toilet.`,
                }
              : { kind: "idle" },
          );
          setAnnouncement(
            isAdd && placedByRef.current === "gps"
              ? "Pin placed at your location."
              : "Map moved to your location.",
          );
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
    if (phaseRef.current !== "moving") startMoving(null);
    setPrompt(null);
    pendingFocusRef.current = "confirm";
    moveMap("coords", () =>
      map.setView([parsed.lat, parsed.lng], Math.max(map.getZoom(), FOCUS_ZOOM), {
        animate: false,
      }),
    );
    setAnnouncement(
      `Map moved to ${formatCoordinates(parsed)}. Check the pin, then choose Use this location.`,
    );
  };

  const dismissIntro = () => {
    rememberIntroDismissed();
    setIntroVisible(false);
  };

  // ── The form's handle ────────────────────────────────────────

  useLayoutEffect(() => {
    if (!controllerRef) return;
    controllerRef.current = {
      resolve: keepOnce,
      placeHere: () => {
        const map = mapRef.current;
        if (!map) return null;
        if (phaseRef.current !== "moving") return currentLocation();
        setPlacedBy(placedByRef.current ?? "pan");
        return commit(toLatLng(map.getCenter()), "confirmed", { focus: false });
      },
      focusMap: () => {
        if (phaseRef.current !== "moving") {
          startMoving("map");
          return;
        }
        container.current?.focus();
      },
      fixIssue: (issue) => {
        if (phaseRef.current !== "moving") return;
        if (issue === "zoom") {
          if ((mapRef.current?.getZoom() ?? MIN_CONFIRM_ZOOM) < MIN_CONFIRM_ZOOM) zoomIn();
          else rootRef.current?.querySelector<HTMLElement>('[data-focus="confirm"]')?.focus();
        } else if (issue === "duplicate") {
          rootRef.current?.querySelector<HTMLElement>('[data-focus="prompt"]')?.focus();
        } else {
          rootRef.current?.querySelector<HTMLElement>('[data-focus="confirm"]')?.focus();
        }
      },
    };
  });
  useEffect(
    () => () => {
      if (controllerRef) controllerRef.current = null;
    },
    [],
  );

  // ── Render ───────────────────────────────────────────────────

  const moving = phase === "moving";
  const hasLocation = hasValidLocation(location);
  const zoomTooFar = moving && zoom < MIN_CONFIRM_ZOOM;
  const move = moving && original && centre ? describeMove(original, centre) : null;
  const showLockedReset = !moving && shouldOfferLocationReset(original, location);
  const lockedMove = !moving && original && hasLocation ? describeMove(original, location) : null;
  const liveCandidate =
    moving && centre
      ? assessCandidate({
          at: centre,
          zoom,
          current: hasLocation ? location : null,
          original,
          placed: placedBy !== null,
          jump: jump !== null,
          promptOpen: prompt !== null,
          approximate: approximate !== null,
        })
      : null;
  const placed = hasLocation || placedBy !== null;
  /** Something has to be answered before the pin can be kept where it is. */
  const liveIssue = liveCandidate ? candidateIssue(liveCandidate, zoom, prompt !== null) : null;
  /** The strip's accent: green only for a pin that is placed and would be kept as it is. */
  const stripPlaced = moving
    ? liveCandidate?.kind === "move" && liveIssue === null
    : hasLocation || placedBy !== null;

  const stripText = (): string => {
    if (!moving) {
      if (lockedMove && !lockedMove.unmoved) {
        return `${lockedMove.label} from the saved location. Locked again.`;
      }
      if (addFlow) return "Pin placed and locked, so scrolling won't move it.";
      return "This is where the toilet is. It's locked so it can't be moved by accident.";
    }
    if (zoomTooFar) return ZOOM_IN_MESSAGE;
    if (addFlow) {
      if (!placed || liveCandidate?.kind === "same" || liveCandidate?.kind === "unplaced") {
        return "Move the map until the pin is on the toilet's entrance.";
      }
      if (placedBy === "search") {
        return "Pin placed at the search result. Move the map if the entrance is somewhere else.";
      }
      if (placedBy === "gps") {
        return "Pin placed at your location. Move the map if the entrance is somewhere else.";
      }
      if (placedBy === "coords") {
        return "Pin placed at the coordinates you entered. Move the map if the entrance is somewhere else.";
      }
      return "Pin placed. Keep moving the map to adjust it, or carry on with the form.";
    }
    // The warning under the strip says what to do about it.
    if (move?.big) return `${move.label}.`;
    if (jump && move && !move.unmoved) {
      return jump === "search"
        ? "Check the pin after your search, then choose “Use this location”."
        : jump === "gps"
          ? "Check the pin is on the toilet, then choose “Use this location”."
          : "Check the pin is on the toilet, then choose “Use this location”.";
    }
    if (move && !move.unmoved) {
      return `${move.label}. This is kept when you carry on with the form.`;
    }
    return "Move the map until the pin is on the toilet's new position. The grey pin shows where it was.";
  };

  const renderPrompt = () => {
    if (!prompt) return null;
    const { match } = prompt;
    const distance = formatDistance(match.distance);
    const name = match.loo.name ?? "an unnamed toilet";
    return (
      // A group (fieldset) named by its question, focused when it appears.
      <fieldset
        class={styles.prompt}
        aria-labelledby={ids.prompt}
        tabIndex={-1}
        data-focus="prompt"
      >
        <Notice
          tone="info"
          size="compact"
          announce="off"
          title={
            <span id={ids.prompt}>
              {match.kind === "active" ? (
                <>
                  There's already a toilet {distance} away: <strong>{name}</strong>. Is it the same
                  one?
                </>
              ) : (
                <>
                  A removed toilet was recorded {distance} away. Is this the same toilet, back
                  again?
                </>
              )}
            </span>
          }
          actions={
            <>
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
              <Button htmlElement="button" type="button" variant="secondary" onClick={notTheSame}>
                No, this is a different toilet
              </Button>
            </>
          }
        />
      </fieldset>
    );
  };

  const mapWrapClass = [styles.mapWrap, moving ? styles.mapWrapMoving : styles.mapWrapLocked]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      class={styles.root}
      data-phase={phase}
      data-placed={placed ? "true" : undefined}
      ref={rootRef}
    >
      {introVisible && !addFlow && (
        <div class={styles.intro}>
          <Notice tone="info" size="compact" announce="off" onDismiss={dismissIntro}>
            {INTRO_MESSAGE}
          </Notice>
        </div>
      )}

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
        <Notice
          tone={geo.kind === "error" ? "error" : "warning"}
          size="compact"
          announce="assertive"
        >
          {geo.message}
        </Notice>
      )}

      <div class={mapWrapClass}>
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
          aria-describedby={ids.strip}
          tabIndex={moving ? 0 : -1}
        />
        {moving && (
          <>
            <span
              class={
                zoomTooFar ? `${styles.centrePin} ${styles.centrePinHollow}` : styles.centrePin
              }
              aria-hidden="true"
              data-hollow={zoomTooFar ? "true" : undefined}
            >
              <span
                class={styles.centrePinIcon}
                dangerouslySetInnerHTML={{
                  __html: zoomTooFar ? HOLLOW_PIN_SVG : getIconString("default"),
                }}
              />
            </span>
            <span class={styles.centreDot} aria-hidden="true" />
          </>
        )}
        {move && !move.unmoved && original && centre && (
          <span
            class={move.big ? `${styles.chip} ${styles.chipWarning}` : styles.chip}
            aria-hidden="true"
            // Kept clear of the grey pin: at the bottom when it is above the centre (a move south).
            data-position={original.lat > centre.lat ? "bottom" : undefined}
          >
            {move.label}
          </span>
        )}
        {!moving && (
          <>
            <span class={styles.badge}>
              <LockIcon />
              Locked
            </span>
            <div class={styles.mapActions}>
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                class={styles.movePin}
                data-focus="movePin"
                onClick={() => startMoving("map", { anchor: true })}
              >
                Move pin
              </Button>
            </div>
            {lockedMessage && (
              <p class={styles.lockedMessage} aria-hidden="true">
                {LOCKED_MESSAGE}
              </p>
            )}
          </>
        )}
      </div>

      <div class={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </div>

      <div class={styles.panel}>
        {/* What the pin is doing, as a compact DS Notice: success for a pin that is placed and
            would be kept as it is, warning while something has to be answered, else info. */}
        <div
          id={ids.strip}
          class={styles.strip}
          data-placed={stripPlaced ? "true" : undefined}
          data-blocked={liveIssue && !zoomTooFar ? "true" : undefined}
          data-too-far={zoomTooFar ? "true" : undefined}
        >
          <Notice
            tone={liveIssue || zoomTooFar ? "warning" : stripPlaced ? "success" : "info"}
            size="compact"
            announce="off"
          >
            {stripText()}
            {moving &&
              nearbyCount > 0 &&
              " Grey dots are toilets already on the map; hollow ones have been removed."}
          </Notice>
        </div>

        {moving && move?.big && (
          <Notice tone="warning" size="compact" announce="assertive" title={BIG_MOVE_WARNING}>
            <p>{BIG_MOVE_HINT}</p>
            {centre && (
              <p>
                <a href={addToiletHref({ lat: centre.lat, lng: centre.lng, zoom })}>
                  Add as a new toilet instead
                </a>
              </p>
            )}
          </Notice>
        )}

        {moving && renderPrompt()}

        {moving && !prompt && (
          <div class={styles.actions} ref={actionsRef}>
            <Button
              htmlElement="button"
              type="button"
              // Adding, it is optional (carrying on with the form keeps the pin), so it doesn't
              // look like a step everyone must take; it is the answer when something blocks.
              variant={addFlow && !zoomTooFar && liveIssue === null ? "secondary" : "primary"}
              data-focus="confirm"
              onClick={zoomTooFar ? zoomIn : confirm}
              disabled={checking}
              aria-describedby={zoomTooFar ? ids.strip : undefined}
            >
              {zoomTooFar ? "Zoom in" : checking ? "Checking…" : "Use this location"}
            </Button>
            {hasLocation && (
              <Button htmlElement="button" type="button" variant="secondary" onClick={cancelMoving}>
                Cancel
              </Button>
            )}
            {move && !move.unmoved && (
              <button type="button" class={styles.linkButton} onClick={resetToOriginal}>
                Reset to original location
              </button>
            )}
          </div>
        )}

        {showLockedReset && (
          <div class={styles.actions}>
            <button type="button" class={styles.linkButton} onClick={resetToOriginal}>
              Reset to original location
            </button>
          </div>
        )}
      </div>

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
