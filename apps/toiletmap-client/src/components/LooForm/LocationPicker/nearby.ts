import { distanceMeters, isValidLatLng, type LatLng } from "../geometry";

/** Radius (metres) of the nearby-toilets lookup around the map centre. */
export const NEARBY_RADIUS_METERS = 150;
/** Nearby toilets are only fetched and drawn at or above this zoom. */
export const NEARBY_MIN_ZOOM = 15;
/** An existing toilet this close (metres) to the chosen spot triggers the "same toilet?" prompt. */
export const DUPLICATE_RADIUS_METERS = 30;

export interface NearbyLoo {
  id: string;
  name: string | null;
  location: LatLng;
  active: boolean;
}

export interface NearbyMatch {
  kind: "active" | "removed";
  loo: NearbyLoo;
  /** Distance in metres from the chosen spot. */
  distance: number;
}

export function buildProximityUrl(
  apiUrl: string,
  centre: LatLng,
  excludeId?: string | null,
  radius: number = NEARBY_RADIUS_METERS,
): string {
  const params = new URLSearchParams({
    lat: String(Number(centre.lat.toFixed(6))),
    lng: String(Number(centre.lng.toFixed(6))),
    radius: String(radius),
    includeInactive: "true",
  });
  if (excludeId) params.set("exclude", excludeId);
  return `${apiUrl}/api/loos/proximity?${params.toString()}`;
}

/**
 * Read the `GET /api/loos/proximity` body ({ data: [...] }) defensively: rows without a usable
 * id or location are dropped, and a missing `active` counts as active (older servers only
 * returned active toilets).
 */
export function parseProximityResponse(body: unknown): NearbyLoo[] {
  const rows =
    body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  const result: NearbyLoo[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { id, name, location, active } = row as Record<string, unknown>;
    if (typeof id !== "string" || !location || typeof location !== "object") continue;
    const { lat, lng } = location as Record<string, unknown>;
    if (typeof lat !== "number" || typeof lng !== "number" || !isValidLatLng(lat, lng)) continue;
    result.push({
      id,
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      location: { lat, lng },
      active: active !== false,
    });
  }
  return result;
}

/**
 * The toilet the user is most likely re-adding (or moving onto): the nearest active toilet within
 * `radius` of `target`, or failing that the nearest removed one. `excludeId` (the toilet being
 * edited) never matches.
 *
 * Moving an existing toilet passes `original` (where it is saved now): only a toilet the pin has
 * been moved towards, closer to the new spot than to the saved one, matches. Nudging a pin next
 * to a neighbour (the Women's next to the Men's, two toilets in one station) asks nothing.
 * `includeRemoved: false` (also for edits) never offers a removed toilet for restoring.
 */
export function findNearbyMatch(
  target: LatLng,
  nearby: readonly NearbyLoo[],
  excludeId?: string | null,
  radius: number = DUPLICATE_RADIUS_METERS,
  {
    original = null,
    includeRemoved = true,
  }: { original?: LatLng | null; includeRemoved?: boolean } = {},
): NearbyMatch | null {
  let active: NearbyMatch | null = null;
  let removed: NearbyMatch | null = null;
  for (const loo of nearby) {
    if (excludeId && loo.id === excludeId) continue;
    const distance = distanceMeters(target, loo.location);
    if (distance > radius) continue;
    if (!loo.active && !includeRemoved) continue;
    if (original && distance >= distanceMeters(original, loo.location)) continue;
    if (loo.active) {
      if (!active || distance < active.distance) active = { kind: "active", loo, distance };
    } else if (!removed || distance < removed.distance) {
      removed = { kind: "removed", loo, distance };
    }
  }
  return active ?? removed;
}
