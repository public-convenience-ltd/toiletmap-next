import type * as L from "leaflet";
import type { LatLngBounds } from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import ngeohash from "ngeohash";
import type { ApiLooResponse, CompressedLooTuple, LooFeatureFlags, MapLoo } from "./types";

type LeafletModule = typeof L;

export const DEFAULT_CENTER: [number, number] = [54.559, -2.11];
export const DEFAULT_ZOOM = 6;
export const FETCH_BATCH_SIZE = 4;
export const VIEWPORT_PADDING = 0.15;
export const FETCH_DEBOUNCE_MS = 260;

export const TILE_TTL_MS = 5 * 60 * 1000;
export const MIN_PRECISION = 2;
export const MAX_TILE_REQUESTS = 200;
export const HYDRATION_MIN_PRECISION = 4;
export const HYDRATION_MIN_ZOOM = 11;
export const HYDRATION_MAX_TILES = 80;
export const HYDRATION_BATCH_SIZE = 4;
export const HYDRATION_LOW_DENSITY_THRESHOLD = 6;
export const HYDRATION_LOW_DENSITY_TILE_LIMIT = 120;

export const PRECISION_BY_ZOOM = [
  { maxZoom: 4, precision: 2 },
  { maxZoom: 6, precision: 3 },
  { maxZoom: 9, precision: 4 },
  { maxZoom: 12, precision: 5 },
  { maxZoom: Number.POSITIVE_INFINITY, precision: 6 },
] as const;

export const DEBUG_COLORS = ["#FF8A5B", "#F4B23E", "#06D6A0", "#118AB2", "#9B5DE5"] as const;

export const FILTER_MASKS = {
  noPayment: 0b00000001,
  allGender: 0b00000010,
  automatic: 0b00000100,
  accessible: 0b00001000,
  babyChange: 0b00010000,
  radar: 0b00100000,
} as const;

export const decodeFilterMask = (mask: number): LooFeatureFlags => ({
  noPayment: Boolean(mask & FILTER_MASKS.noPayment),
  allGender: Boolean(mask & FILTER_MASKS.allGender),
  automatic: Boolean(mask & FILTER_MASKS.automatic),
  accessible: Boolean(mask & FILTER_MASKS.accessible),
  babyChange: Boolean(mask & FILTER_MASKS.babyChange),
  radar: Boolean(mask & FILTER_MASKS.radar),
});

export const describeFeatures = (flags: LooFeatureFlags) => {
  const labels = [] as string[];
  if (flags.accessible) labels.push("Accessible");
  if (flags.noPayment) labels.push("Free");
  if (flags.radar) labels.push("RADAR");
  if (flags.babyChange) labels.push("Baby change");
  if (flags.allGender) labels.push("All gender");
  if (flags.automatic) labels.push("Automatic");
  return labels.join(" · ") || "No feature data";
};

export const getDebugColor = (tile: string) =>
  DEBUG_COLORS[tile.length % DEBUG_COLORS.length] ?? DEBUG_COLORS[0];

export const buildIconSvg = (isHighlighted: boolean) => {
  const glyph = isHighlighted
    ? '<path d="M10 4L11.7634 7.57295L15.7063 8.1459L12.8532 10.9271L13.5267 14.8541L10 13L6.47329 14.8541L7.14683 10.9271L4.29366 8.1459L8.23664 7.57295L10 4Z" fill="white"/>'
    : '<circle cx="10" cy="10" r="5" fill="white"/>';
  return `<svg viewBox="-1 -1 21 33" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;" aria-hidden="true" focusable="false">
      <path d="M10 0C4.47632 0 0 4.47529 0 10C0 19.5501 10 32 10 32C10 32 20 19.5501 20 10C20 4.47529 15.5237 0 10 0Z" fill="#ED3D63" stroke="white"/>
      ${glyph}
    </svg>`;
};

export const createToiletIcon = (leaflet: LeafletModule, isHighlighted: boolean) =>
  leaflet.divIcon({
    html: buildIconSvg(isHighlighted),
    className: "toilet-marker",
    iconSize: [32, 42],
    iconAnchor: [16, 40],
  });

export const getPrecisionForZoom = (zoom: number) => {
  for (const bucket of PRECISION_BY_ZOOM) {
    if (zoom <= bucket.maxZoom) return bucket.precision;
  }
  return PRECISION_BY_ZOOM[PRECISION_BY_ZOOM.length - 1]?.precision ?? 5;
};

export const computeTilesForBounds = (bounds: LatLngBounds, zoom: number) => {
  let precision = getPrecisionForZoom(zoom);

  const uniqueTiles = (prec: number) => {
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    const rawTiles = ngeohash.bboxes(
      southWest.lat,
      southWest.lng,
      northEast.lat,
      northEast.lng,
      prec,
    );
    return Array.from(new Set(rawTiles));
  };

  let tiles = uniqueTiles(precision);
  while (tiles.length > MAX_TILE_REQUESTS && precision > MIN_PRECISION) {
    precision -= 1;
    tiles = uniqueTiles(precision);
  }

  return { tiles, precision };
};

export const getClusterRadius = (zoom: number) => {
  if (zoom >= 16) return 18;
  if (zoom >= 15) return 28;
  if (zoom >= 13) return 50;
  if (zoom >= 11) return 80;
  return 130;
};

export const inflateTileData = (tuples: CompressedLooTuple[]): MapLoo[] =>
  tuples.map(([id, geohash, mask]) => {
    const { latitude, longitude } = ngeohash.decode(geohash);
    return {
      id,
      geohash,
      lat: latitude,
      lng: longitude,
      features: decodeFilterMask(mask),
      detailLevel: "compressed",
    };
  });

const resolveLatLng = (
  geohash: string,
  location: ApiLooResponse["location"],
): { lat: number; lng: number } => {
  if (location && typeof location.lat === "number" && typeof location.lng === "number") {
    return location;
  }
  if (!geohash) {
    throw new Error("Missing geohash for loo");
  }
  const decoded = ngeohash.decode(geohash);
  return { lat: decoded.latitude, lng: decoded.longitude };
};

export const mapFullLooResponse = (loo: ApiLooResponse): MapLoo => {
  const geohash = loo.geohash ?? "";
  if (!geohash) {
    throw new Error(`Loo ${loo.id} missing geohash`);
  }
  const coords = resolveLatLng(geohash, loo.location);
  return {
    id: loo.id,
    geohash,
    lat: coords.lat,
    lng: coords.lng,
    features: {
      accessible: Boolean(loo.accessible),
      babyChange: Boolean(loo.babyChange),
      radar: Boolean(loo.radar),
      automatic: Boolean(loo.automatic),
      allGender: Boolean(loo.allGender),
      noPayment: Boolean(loo.noPayment),
    },
    detailLevel: "full",
    full: loo,
  };
};

export const parseCompressedResponse = (payload: unknown): CompressedLooTuple[] => {
  if (!payload || typeof payload !== "object") throw new Error("Unexpected API response");
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error("Malformed compressed payload");

  return data.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 3) throw new Error("Invalid compressed entry");
    const [id, geohash, mask] = entry;
    if (typeof id !== "string" || typeof geohash !== "string" || typeof mask !== "number") {
      throw new Error("Invalid compressed tuple contents");
    }
    return [id, geohash, mask];
  });
};

export const loadLeaflet = async (): Promise<LeafletModule> => {
  const { default: leaflet } = await import("leaflet");
  await import("leaflet.markercluster");
  // Fix default icon lookups for bundlers
  // @ts-expect-error - private Leaflet internals
  leaflet.Icon.Default.prototype._getIconUrl = undefined;
  leaflet.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl,
  });
  return leaflet;
};
