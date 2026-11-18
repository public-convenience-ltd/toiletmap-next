import { DAYS, isOpen24Every, isOpenNow, sameDay } from "@toiletmap/opening-hours";
import type { IconName } from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import { removalCategoryLabel } from "../../api/reports";

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "40 m", "850 m", "1.2 km", "14 km". Metres are rounded to 10 below 1 km. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return "";
  if (metres < 995) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  const km = metres / 1000;
  return km < 9.95 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** The distance line ("350 m away"), or null when either end is unknown. */
export function distanceText(
  from: LatLng | null | undefined,
  to: LatLng | null | undefined,
): string | null {
  if (!from || !to) return null;
  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) return null;
  const text = formatDistance(haversineMetres(from, to));
  return text ? `${text} away` : null;
}

export interface PlatformInfo {
  userAgent?: string;
  platform?: string;
}

/** iPhone, iPad (including iPadOS, which reports itself as a Mac) and macOS. */
export function isApplePlatform(info: PlatformInfo): boolean {
  const ua = info.userAgent ?? "";
  const platform = info.platform ?? "";
  return (
    /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua) || /^(Mac|iPhone|iPad|iPod)/i.test(platform)
  );
}

/** Walking directions: Apple Maps on Apple platforms, Google Maps everywhere else. */
export function directionsUrl(
  location: LatLng,
  info: PlatformInfo = typeof navigator === "undefined"
    ? {}
    : { userAgent: navigator.userAgent, platform: navigator.platform },
): string {
  const point = `${location.lat},${location.lng}`;
  if (isApplePlatform(info)) {
    return `https://maps.apple.com/?daddr=${point}&dirflg=w`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=walking`;
}

export type StatusTone = "open" | "closed" | "unknown";

/** The summary's status chip: "Open now · closes 6pm", "Closed · opens 9am tomorrow", … */
export function openStatus(
  openingTimes: LooDetail["openingTimes"] | undefined,
  now: Date,
): { tone: StatusTone; text: string } {
  const status = isOpenNow(openingTimes, now);
  if (status.state === "open") {
    if (status.closesAt) return { tone: "open", text: `Open now · closes ${status.closesAt}` };
    return { tone: "open", text: isOpen24Every(openingTimes) ? "Open 24 hours" : "Open now" };
  }
  if (status.state === "closed") {
    return { tone: "closed", text: status.opensAt ? `Closed · opens ${status.opensAt}` : "Closed" };
  }
  return { tone: "unknown", text: "Hours not known" };
}

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * The freshness line: whichever of the last verification and the last edit is more recent,
 * with the matching label (verifying doesn't bump `updatedAt`, and an edit doesn't verify).
 */
export function freshnessLine(
  verifiedAt: string | null | undefined,
  updatedAt: string | null | undefined,
): string {
  const time = (iso: string | null | undefined) => {
    const ms = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  const verified = time(verifiedAt);
  const updated = time(updatedAt);
  if (verified !== null && (updated === null || verified >= updated)) {
    return `Last verified: ${formatDate(verifiedAt ?? null)}`;
  }
  return `Last updated: ${formatDate(updated === null ? null : (updatedAt ?? null))}`;
}

export const REMOVED_MESSAGE = "This toilet has been removed from the map";

/**
 * "Removed from the map: <category> — <reason>" for a removed toilet, or null when neither is
 * recorded (the generic {@link REMOVED_MESSAGE} is shown instead).
 */
export function removalSummary(toilet: LooDetail): string | null {
  const label = removalCategoryLabel(toilet.removalCategory);
  const reason = typeof toilet.removalReason === "string" ? toilet.removalReason.trim() : "";
  if (!label && !reason) return null;
  return `Removed from the map${label ? `: ${label}` : ""}${reason ? ` — ${reason}` : ""}`;
}

export interface KeyFeature {
  key: string;
  label: string;
  icon: "wheelchair-move" | "baby" | "key" | "toilet";
}

/**
 * Up to four headline features for the summary, in a fixed order; only what's present.
 * Payment isn't one: it's a text chip ({@link paymentChip}), as an icon couldn't tell free
 * from paid.
 */
export function keyFeatures(toilet: LooDetail): KeyFeature[] {
  const features: KeyFeature[] = [];
  if (toilet.accessible === true)
    features.push({ key: "accessible", label: "Accessible", icon: "wheelchair-move" });
  if (toilet.babyChange === true)
    features.push({ key: "babyChange", label: "Baby changing", icon: "baby" });
  if (toilet.radar === true) features.push({ key: "radar", label: "RADAR key", icon: "key" });
  if (toilet.allGender === true)
    features.push({ key: "allGender", label: "All-gender", icon: "toilet" });
  return features;
}

/** "Free", "Paid" or "Paid: 20p", or null when it isn't known whether it costs anything. */
export function paymentText(
  toilet: Pick<LooDetail, "noPayment" | "paymentDetails">,
): string | null {
  if (toilet.noPayment === true) return "Free";
  if (toilet.noPayment === false) {
    const details = typeof toilet.paymentDetails === "string" ? toilet.paymentDetails.trim() : "";
    return details ? `Paid: ${details}` : "Paid";
  }
  return null;
}

/** True when all seven days are known and have the same hours (one sentence says it all). */
export function isUniformWeek(
  openingTimes: readonly (readonly string[] | null | undefined)[] | null | undefined,
): boolean {
  if (!Array.isArray(openingTimes) || openingTimes.length !== DAYS.length) return false;
  const first = openingTimes[0];
  return openingTimes.every((day) => Array.isArray(day) && sameDay(day, first));
}

type FacilityKey =
  | "accessible"
  | "allGender"
  | "men"
  | "women"
  | "children"
  | "babyChange"
  | "radar"
  | "automatic";

export const FACILITIES: ReadonlyArray<{ key: FacilityKey; label: string; icon: IconName }> = [
  { key: "accessible", label: "Accessible", icon: "wheelchair-move" },
  { key: "allGender", label: "All-gender", icon: "toilet" },
  { key: "men", label: "Men", icon: "person" },
  { key: "women", label: "Women", icon: "person-dress" },
  { key: "children", label: "Children", icon: "child" },
  { key: "babyChange", label: "Baby changing", icon: "baby" },
  { key: "radar", label: "RADAR key", icon: "key" },
  { key: "automatic", label: "Automatic", icon: "gear" },
];

export interface KnownFacility {
  key: FacilityKey;
  label: string;
  icon: IconName;
  value: boolean;
}

/**
 * The facilities split into those with a yes / no answer (shown as rows) and the labels of
 * the unknown ones, payment included (one "Not known: …" line).
 */
export function splitFacilities(toilet: LooDetail): { known: KnownFacility[]; unknown: string[] } {
  const known: KnownFacility[] = [];
  const unknown: string[] = [];
  for (const facility of FACILITIES) {
    const value = toilet[facility.key];
    if (typeof value === "boolean") known.push({ ...facility, value });
    else unknown.push(facility.label);
  }
  if (paymentText(toilet) === null) unknown.push("Payment");
  return { known, unknown };
}
