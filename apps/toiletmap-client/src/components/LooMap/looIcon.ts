import L from "leaflet";

/**
 * The Toilet Map pin, shared by the main map and the add/edit location picker.
 *
 * - `default`: a pink pin with a white dot (every toilet on the map, and the picker's pin).
 * - `highlighted`: larger, with a star (the selected toilet).
 * - `muted`: a grey, translucent pin (the picker's "original location" ghost).
 */
export type LooIconVariant = "default" | "highlighted" | "muted";

const PIN_PATH =
  "M10 0C4.47632 0 0 4.47529 0 10C0 19.5501 10 32 10 32C10 32 20 19.5501 20 10C20 4.47529 15.5237 0 10 0Z";
const STAR_PATH =
  "M10 4L11.7634 7.57295L15.7063 8.1459L12.8532 10.9271L13.5267 14.8541L10 13L6.47329 14.8541L7.14683 10.9271L4.29366 8.1459L8.23664 7.57295L10 4Z";

export const BRAND_PINK = "#ED3D63";
const MUTED_GREY = "#8A90A8";

/** Pixel size [width, height] of each variant; the anchor is the pin's tip (bottom centre). */
export const LOO_ICON_SIZE: Record<LooIconVariant, [number, number]> = {
  default: [21, 33],
  highlighted: [28, 44],
  muted: [21, 33],
};

export function getIconString(variant: LooIconVariant = "default"): string {
  const [width, height] = LOO_ICON_SIZE[variant];
  const fill = variant === "muted" ? MUTED_GREY : BRAND_PINK;
  const opacity = variant === "muted" ? ' opacity="0.75"' : "";
  const centre =
    variant === "highlighted"
      ? `<path d="${STAR_PATH}" fill="white"/>`
      : '<circle cx="10" cy="10" r="5" fill="white"/>';
  return `<svg viewBox="-1 -1 21 33" height="${height}" width="${width}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"${opacity}><path d="${PIN_PATH}" fill="${fill}" stroke="white"/>${centre}</svg>`;
}

export function makeIcon(variant: LooIconVariant = "default"): L.DivIcon {
  const [width, height] = LOO_ICON_SIZE[variant];
  return L.divIcon({
    html: getIconString(variant),
    className: variant === "muted" ? "loo-marker loo-marker--muted" : "loo-marker",
    iconSize: [width, height],
    iconAnchor: [width / 2, height],
    popupAnchor: [0, -height],
  });
}
