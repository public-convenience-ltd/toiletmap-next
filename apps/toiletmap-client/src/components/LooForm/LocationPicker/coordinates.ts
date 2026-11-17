import type { LatLng } from "../geometry";

/** A generous box around the UK (incl. Northern Ireland, Scilly, Shetland and the Channel Islands). */
export const UK_BOUNDS = { minLat: 49, maxLat: 61, minLng: -9, maxLng: 2.5 } as const;

export const isInUk = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= UK_BOUNDS.minLat &&
  lat <= UK_BOUNDS.maxLat &&
  lng >= UK_BOUNDS.minLng &&
  lng <= UK_BOUNDS.maxLng;

export type ParsedCoordinates =
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string };

export const COORDINATES_EXAMPLE = "51.5034, -0.1276";

const EMPTY_ERROR = `Enter a latitude and longitude, for example ${COORDINATES_EXAMPLE}.`;
const FORMAT_ERROR = `Enter the latitude, then the longitude, separated by a comma, for example ${COORDINATES_EXAMPLE}.`;
const SWAPPED_ERROR = `Those look the wrong way round. Enter the latitude first, for example ${COORDINATES_EXAMPLE}.`;
const OUTSIDE_UK_ERROR =
  "Those coordinates aren't in the UK. Toilet Map only covers the UK (latitude 49 to 61, longitude -9 to 2.5).";

const NUMBER = String.raw`[-+−]?\d+(?:\.\d+)?`;

/** `@51.5034,-0.1276,17z` in a Google Maps URL (the map view's centre). */
const GOOGLE_AT = new RegExp(`@(${NUMBER}),(${NUMBER})`);
/** `!3d51.5034!4d-0.1276` in a Google Maps place URL (the place itself, preferred over `@`). */
const GOOGLE_PLACE = new RegExp(`!3d(${NUMBER})!4d(${NUMBER})`);
/** `?q=51.5,-0.12`, `query=`, `ll=`, `center=`, `destination=` query parameters. */
const QUERY_PARAMS = ["q", "query", "ll", "center", "destination"];

/** One coordinate with an optional degree sign and N/S/E/W hemisphere, e.g. `51.5034° N`. */
const PART = new RegExp(String.raw`^(${NUMBER})\s*°?\s*([NSEW])?$`, "i");

const toNumber = (text: string) => Number(text.replace("−", "-"));

/** Interpret "lat, lng" / "lat lng" text (with optional ° and N/S/E/W). Null when it isn't a pair. */
function parsePair(text: string): LatLng | null {
  const cleaned = text
    .trim()
    .replace(/^[([]\s*/, "")
    .replace(/\s*[)\]]$/, "");
  // Split on a comma or semicolon if there is one, else on whitespace between two numbers.
  let parts = cleaned.split(/\s*[,;]\s*/);
  if (parts.length === 1) {
    const match = cleaned.match(
      new RegExp(String.raw`^(${NUMBER}\s*°?\s*[NSEW]?)\s+(${NUMBER}\s*°?\s*[NSEW]?)$`, "i"),
    );
    if (!match) return null;
    parts = [match[1], match[2]];
  }
  if (parts.length !== 2) return null;

  const parsed = parts.map((part) => {
    const match = part.trim().match(PART);
    if (!match) return null;
    const value = toNumber(match[1]);
    const hemisphere = match[2]?.toUpperCase() ?? null;
    return { value, hemisphere };
  });
  const [first, second] = parsed;
  if (!first || !second || !Number.isFinite(first.value) || !Number.isFinite(second.value)) {
    return null;
  }

  const signed = ({ value, hemisphere }: { value: number; hemisphere: string | null }) =>
    hemisphere === "S" || hemisphere === "W" ? -Math.abs(value) : value;
  const isLngLetter = (h: string | null) => h === "E" || h === "W";
  const isLatLetter = (h: string | null) => h === "N" || h === "S";

  // Hemisphere letters say which is which: "0.1276 W, 51.5034 N" is unambiguous.
  if (isLngLetter(first.hemisphere) && (isLatLetter(second.hemisphere) || !second.hemisphere)) {
    return { lat: signed(second), lng: signed(first) };
  }
  return { lat: signed(first), lng: signed(second) };
}

function fromUrl(text: string): LatLng | null {
  const place = text.match(GOOGLE_PLACE);
  if (place) return { lat: toNumber(place[1]), lng: toNumber(place[2]) };
  const at = text.match(GOOGLE_AT);
  if (at) return { lat: toNumber(at[1]), lng: toNumber(at[2]) };
  try {
    const url = new URL(text);
    for (const name of QUERY_PARAMS) {
      const value = url.searchParams.get(name);
      if (!value) continue;
      const pair = parsePair(value);
      if (pair) return pair;
    }
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Parse pasted coordinates: "51.5034, -0.1276", "51.5034 -0.1276", "51.5034° N, 0.1276° W",
 * or a Google Maps link (`…/@51.5034,-0.1276,17z`, `…!3d51.5034!4d-0.1276`, `?q=51.5,-0.12`).
 * Only UK locations are accepted.
 */
export function parseCoordinates(input: string): ParsedCoordinates {
  const text = input.trim();
  if (!text) return { ok: false, error: EMPTY_ERROR };

  const looksLikeUrl = /^https?:\/\//i.test(text) || /^(www\.)?(maps\.)?google\./i.test(text);
  const pair = looksLikeUrl
    ? fromUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    : parsePair(text);
  if (!pair || !Number.isFinite(pair.lat) || !Number.isFinite(pair.lng)) {
    return {
      ok: false,
      error: looksLikeUrl
        ? "We couldn't find coordinates in that link. Copy the coordinates instead, for example 51.5034, -0.1276."
        : FORMAT_ERROR,
    };
  }

  const { lat, lng } = pair;
  if (isInUk(lat, lng)) return { ok: true, lat, lng };
  // Longitude first is a common mistake (GeoJSON order): catch it rather than reject as "not UK".
  if (isInUk(lng, lat)) return { ok: false, error: SWAPPED_ERROR };
  return { ok: false, error: OUTSIDE_UK_ERROR };
}

/** "51.503400, -0.127600" trimmed of trailing zeros: "51.5034, -0.1276". */
export function formatCoordinates(location: LatLng | null): string {
  if (!location) return "";
  const fmt = (n: number) => String(Number(n.toFixed(6)));
  return `${fmt(location.lat)}, ${fmt(location.lng)}`;
}
