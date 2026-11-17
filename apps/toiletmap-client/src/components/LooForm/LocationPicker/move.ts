import { distanceMeters, type LatLng } from "../geometry";

/** Moves larger than this (in metres) from the saved location get a "big move" warning. */
export const BIG_MOVE_METERS = 50;

/** Moves at or below this (in metres) count as "not moved" (matches the form's change threshold). */
export const NOT_MOVED_METERS = 0.5;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Initial great-circle bearing from `from` to `to`, in degrees clockwise from north (0–360). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export const COMPASS_POINTS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** The nearest of the eight compass points to a bearing (each covers a 45° sector). */
export function compassPoint(bearing: number): CompassPoint {
  const normalised = ((bearing % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalised / 45) % 8];
}

/** "8 m", "430 m", "1.2 km", "12 km". Never "0 m": anything under a metre reads "under 1 m". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1) return "under 1 m";
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1).replace(/\.0$/, "") : Math.round(km)} km`;
}

export interface MoveSummary {
  meters: number;
  direction: CompassPoint | null;
  /** True when the move is too small to count as a change. */
  unmoved: boolean;
  /** True when the move is large enough to deserve a "same toilet?" warning. */
  big: boolean;
  /** "Moved 23 m north-east" or "At the original location". */
  label: string;
}

/** How far, and which way, the pin has moved from where it started. */
export function describeMove(from: LatLng, to: LatLng): MoveSummary {
  const meters = distanceMeters(from, to);
  if (meters <= NOT_MOVED_METERS) {
    return {
      meters,
      direction: null,
      unmoved: true,
      big: false,
      label: "At the original location",
    };
  }
  const direction = compassPoint(bearingDegrees(from, to));
  return {
    meters,
    direction,
    unmoved: false,
    big: meters > BIG_MOVE_METERS,
    label: `Moved ${formatDistance(meters)} ${direction}`,
  };
}
