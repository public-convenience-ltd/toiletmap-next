/**
 * The main map's last view, remembered in localStorage so the map (and the "Add a toilet" picker)
 * reopen where the user left off. Every access is best effort: storage can be disabled, full, or
 * hold junk from an older version.
 */

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export const MAP_VIEW_STORAGE_KEY = "toiletmap-map-view";

/** Where the map opens with no deep link and nothing remembered. */
export const DEFAULT_MAP_VIEW: MapView = { lat: 51.505, lng: -0.09, zoom: 13 };

const MIN_ZOOM = 0;
const MAX_ZOOM = 19;

/** A usable view, or null. Zoom is clamped to Leaflet's range; lat/lng must be real coordinates. */
export function toMapView(lat: unknown, lng: unknown, zoom: unknown): MapView | null {
  const la = typeof lat === "string" ? Number(lat) : lat;
  const ln = typeof lng === "string" ? Number(lng) : lng;
  const z = typeof zoom === "string" ? Number(zoom) : zoom;
  if (typeof la !== "number" || typeof ln !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(la) || !Number.isFinite(ln) || !Number.isFinite(z)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z))) };
}

export function readMapView(storage: Storage | null = safeLocalStorage()): MapView | null {
  try {
    const raw = storage?.getItem(MAP_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return null;
    return toMapView(value.lat, value.lng, value.zoom);
  } catch {
    return null;
  }
}

export function writeMapView(view: MapView, storage: Storage | null = safeLocalStorage()): void {
  const valid = toMapView(view.lat, view.lng, view.zoom);
  if (!valid) return;
  try {
    storage?.setItem(
      MAP_VIEW_STORAGE_KEY,
      JSON.stringify({
        lat: Number(valid.lat.toFixed(6)),
        lng: Number(valid.lng.toFixed(6)),
        zoom: valid.zoom,
      }),
    );
  } catch {
    // Storage full or disabled: remembering the view is only a convenience.
  }
}

/** The zoom a pin can be placed at in the add/edit location picker. */
export const PIN_PLACE_ZOOM = 17;
/** A main-map view at least this close opens the add form at PIN_PLACE_ZOOM. */
export const CLOSE_VIEW_ZOOM = 15;

/**
 * Where the add form's picker opens for a main-map view: a view at zoom 15 or closer is close
 * enough to be the spot the user meant, so it opens at 17, where the pin can be placed straight
 * away (and the streets around it are still in view). Further out, the view is used as it is.
 */
export function addFormView(view: MapView): MapView {
  return view.zoom >= CLOSE_VIEW_ZOOM ? { ...view, zoom: PIN_PLACE_ZOOM } : view;
}

/** `?lat=…&lng=…&zoom=…` from a URL search string (e.g. the "Add a toilet here" link). */
export function mapViewFromSearch(search: string): MapView | null {
  try {
    const params = new URLSearchParams(search);
    if (!params.has("lat") || !params.has("lng")) return null;
    return toMapView(params.get("lat"), params.get("lng"), params.get("zoom") ?? "17");
  } catch {
    return null;
  }
}

/** The add page, opened at a map view: `/loos/add?lat=51.5&lng=-0.12&zoom=17`. */
export function addToiletHref(view: MapView | null): string {
  if (!view) return "/loos/add";
  const valid = toMapView(view.lat, view.lng, view.zoom);
  if (!valid) return "/loos/add";
  const params = new URLSearchParams({
    lat: String(Number(valid.lat.toFixed(6))),
    lng: String(Number(valid.lng.toFixed(6))),
    zoom: String(valid.zoom),
  });
  return `/loos/add?${params.toString()}`;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
