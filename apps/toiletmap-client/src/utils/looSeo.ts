/**
 * Title, description and schema.org JSON-LD for a toilet's page (/loos/:id), built from the
 * API's loo detail. Pure functions: the page fetches the loo, these only describe it.
 */
import {
  DAYS,
  is24h,
  normaliseOpeningTimes,
  summariseOpeningTimes,
} from "@toiletmap/opening-hours";
import type { LooDetail } from "../api/loos";
import { absoluteUrl, pageTitle, SITE_NAME, truncate } from "./seo";

/** The toilet's name, or a generic one when it has none. */
export function looDisplayName(loo: Pick<LooDetail, "name">): string {
  return loo.name?.trim() || "Public toilet";
}

/** The first area the API put the toilet in (e.g. a borough), if any. */
export function looAreaName(loo: LooDetail): string | null {
  const area = loo.area;
  if (!Array.isArray(area)) return null;
  for (const entry of area) {
    const name = (entry as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

/**
 * Facilities with a known yes or no, as schema.org amenity names. Unknown (null) facilities
 * are left out rather than reported as missing.
 */
const AMENITIES: ReadonlyArray<{ key: keyof LooDetail; name: string; summary: string }> = [
  { key: "accessible", name: "Wheelchair accessible", summary: "accessible" },
  { key: "radar", name: "RADAR key", summary: "RADAR key" },
  { key: "babyChange", name: "Baby changing", summary: "baby changing" },
  { key: "allGender", name: "All-gender", summary: "all-gender" },
  { key: "men", name: "Men's toilets", summary: "men" },
  { key: "women", name: "Women's toilets", summary: "women" },
  { key: "children", name: "Children's toilets", summary: "children" },
  { key: "automatic", name: "Automatic", summary: "automatic" },
  { key: "attended", name: "Attended", summary: "attended" },
  { key: "urinalOnly", name: "Urinal only", summary: "urinal only" },
];

/** "Victoria Park, Hackney" style title for the page (without the site name). */
function looHeading(loo: LooDetail): string {
  const name = looDisplayName(loo);
  const area = looAreaName(loo);
  return area && !name.toLowerCase().includes(area.toLowerCase()) ? `${name}, ${area}` : name;
}

export function isRemovedLoo(loo: Pick<LooDetail, "active">): boolean {
  return loo.active === false;
}

/** A one-paragraph description for the meta description and social cards. */
export function looDescription(loo: LooDetail): string {
  const area = looAreaName(loo);
  const name = looDisplayName(loo);
  if (isRemovedLoo(loo)) {
    return truncate(
      `${name}${area ? ` in ${area}` : ""} has been removed from the Toilet Map. Find another public toilet nearby on the map.`,
      300,
    );
  }

  const features = AMENITIES.filter(({ key }) => loo[key] === true).map(({ summary }) => summary);
  if (loo.noPayment === true) features.push("free to use");
  else if (loo.noPayment === false) features.push("charges a fee");

  let sentence = `Public toilet${area ? ` in ${area}` : ""}`;
  if (features.length > 0) sentence += `: ${features.join(", ")}`;
  sentence += ".";
  const hours = loo.openingTimes ? summariseOpeningTimes(loo.openingTimes) : null;
  const tail = hours ? ` Opening hours: ${hours}.` : " Opening hours not known.";
  return truncate(`${sentence}${tail} Directions, facilities and updates on the Toilet Map.`, 300);
}

/**
 * The page's server-rendered <h1> (visually hidden: the panel shows the name): "Victoria
 * Park, Hackney: public toilet", without repeating "toilet" when the name already says it.
 */
export function looPageHeading(loo: LooDetail): string {
  const heading = looHeading(loo);
  const named = /toilet|\bloos?\b|\bwc\b/i.test(heading) ? heading : `${heading}: public toilet`;
  return isRemovedLoo(loo) ? `${named} (removed)` : named;
}

export function looTitle(loo: LooDetail): string {
  return pageTitle(isRemovedLoo(loo) ? `Removed: ${looHeading(loo)}` : looHeading(loo));
}

/** schema.org closes 24-hour days at 23:59 and has no "24:00". */
const schemaTime = (time: string) => (time === "24:00" ? "23:59" : time);

export interface OpeningHoursSpecification {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

/**
 * schema.org opening hours, one entry per group of days with the same hours. Closed days are
 * left out (a day with no entry is closed); open-24-hours days are 00:00–23:59. Returns null
 * when the hours are not known.
 */
export function openingHoursSpecification(
  openingTimes: LooDetail["openingTimes"],
): OpeningHoursSpecification[] | null {
  if (!Array.isArray(openingTimes)) return null;
  const week = normaliseOpeningTimes(openingTimes);
  const specs: OpeningHoursSpecification[] = [];
  week.forEach((day, index) => {
    if (day.length !== 2) return;
    const [opens, closes] = is24h(day) ? ["00:00", "23:59"] : [day[0], schemaTime(day[1])];
    const dayOfWeek = `https://schema.org/${DAYS[index]}`;
    const same = specs.find((spec) => spec.opens === opens && spec.closes === closes);
    if (same) same.dayOfWeek.push(dayOfWeek);
    else
      specs.push({ "@type": "OpeningHoursSpecification", dayOfWeek: [dayOfWeek], opens, closes });
  });
  return specs;
}

/** The `@id` of a toilet's PublicToilet node: its page URL plus a fragment. */
export const looEntityId = (canonicalUrl: string): string => `${canonicalUrl}#toilet`;

/**
 * JSON-LD for an active toilet, as a `@graph` of two nodes:
 * - a schema.org PublicToilet (a Place, so only Place properties): its location, facilities
 *   as amenity features (with any payment details as one), whether it is free and, when
 *   known, its opening hours;
 * - the WebPage about it, which carries what belongs to the page rather than the place: when
 *   it was last modified and the site it is part of, with the toilet as its mainEntity.
 * Returns null for a removed toilet (it is not a place anyone should be sent to).
 */
export function looJsonLd(
  loo: LooDetail,
  canonicalUrl: string,
  pageName: string = looTitle(loo),
): Record<string, unknown> | null {
  if (isRemovedLoo(loo)) return null;
  const toiletId = looEntityId(canonicalUrl);
  const toilet: Record<string, unknown> = {
    "@type": "PublicToilet",
    "@id": toiletId,
    name: looDisplayName(loo),
    url: canonicalUrl,
    description: looDescription(loo),
    publicAccess: true,
  };
  if (loo.location) {
    toilet.geo = {
      "@type": "GeoCoordinates",
      latitude: loo.location.lat,
      longitude: loo.location.lng,
    };
  }
  const area = looAreaName(loo);
  if (area) {
    toilet.address = { "@type": "PostalAddress", addressLocality: area, addressCountry: "GB" };
  }
  const amenities: Record<string, unknown>[] = AMENITIES.filter(
    ({ key }) => typeof loo[key] === "boolean",
  ).map(({ key, name }) => ({
    "@type": "LocationFeatureSpecification",
    name,
    value: loo[key] as boolean,
  }));
  if (loo.noPayment === false && loo.paymentDetails?.trim()) {
    amenities.push({
      "@type": "LocationFeatureSpecification",
      name: "Payment",
      value: truncate(loo.paymentDetails.trim(), 100),
    });
  }
  if (amenities.length > 0) toilet.amenityFeature = amenities;
  if (typeof loo.noPayment === "boolean") toilet.isAccessibleForFree = loo.noPayment;
  const hours = openingHoursSpecification(loo.openingTimes);
  if (hours && hours.length > 0) toilet.openingHoursSpecification = hours;

  const page: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": canonicalUrl,
    url: canonicalUrl,
    name: pageName,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/", canonicalUrl) },
    mainEntity: { "@id": toiletId },
  };
  if (typeof loo.updatedAt === "string") page.dateModified = loo.updatedAt;

  return { "@context": "https://schema.org", "@graph": [page, toilet] };
}

export interface LooPageMeta {
  title: string;
  description: string;
  /**
   * The page's canonical URL. Undefined for a removed toilet: a noindex page with a canonical
   * sends search engines mixed signals, so BaseLayout leaves it out.
   */
  canonical: string | undefined;
  /** Removed toilets stay reachable (their panel explains, and can restore) but unindexed. */
  noindex: boolean;
  jsonLd: Record<string, unknown> | null;
}

/** Everything BaseLayout needs for a toilet's page. */
export function looPageMeta(loo: LooDetail, site: URL | string | undefined | null): LooPageMeta {
  const canonical = absoluteUrl(`/loos/${encodeURIComponent(loo.id)}`, site);
  const removed = isRemovedLoo(loo);
  const title = looTitle(loo);
  return {
    title,
    description: looDescription(loo),
    canonical: removed ? undefined : canonical,
    noindex: removed,
    jsonLd: looJsonLd(loo, canonical, title),
  };
}
