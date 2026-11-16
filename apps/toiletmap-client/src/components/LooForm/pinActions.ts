import type { LatLng } from "./geometry";
import { locationMoved } from "./payload";

export interface ScreenPoint {
  x: number;
  y: number;
}

/** How far (in screen pixels) the marker may sit from the map centre and still count as centred. */
export const CENTRE_TOLERANCE_PX = 12;

/**
 * Whether the centre crosshair should be shown: always while no pin is placed, and otherwise
 * whenever the marker is not at the map centre (which includes it being off-screen), so the user
 * can see where "Move pin to centre of map" would put it.
 */
export function shouldShowCrosshair(
  markerPoint: ScreenPoint | null,
  centrePoint: ScreenPoint,
  tolerancePx: number = CENTRE_TOLERANCE_PX,
): boolean {
  if (!markerPoint) return true;
  if (!Number.isFinite(markerPoint.x) || !Number.isFinite(markerPoint.y)) return true;
  return Math.hypot(markerPoint.x - centrePoint.x, markerPoint.y - centrePoint.y) > tolerancePx;
}

/**
 * Whether to offer "Reset to original location": only when there is an original location and the
 * pin has moved away from it by more than the form's change threshold (so the button appears
 * exactly when the location would be submitted as a change).
 */
export function shouldOfferLocationReset(
  original: LatLng | null | undefined,
  current: LatLng | null,
): boolean {
  if (!original) return false;
  return locationMoved(original, current);
}
