import type { LatLng } from "./geometry";
import { locationMoved } from "./payload";

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
