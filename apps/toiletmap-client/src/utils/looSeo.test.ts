// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LooDetail } from "../api/loos";
import {
  looDescription,
  looDisplayName,
  looJsonLd,
  looPageHeading,
  looPageMeta,
  looTitle,
  openingHoursSpecification,
} from "./looSeo";
import { serializeJsonLd } from "./seo";

const SITE = "https://www.toiletmap.org.uk";
const ID = "0123456789abcdef01234567";

const loo = (overrides: Partial<LooDetail> = {}): LooDetail => ({
  id: ID,
  name: "Victoria Park",
  location: { lat: 51.5362, lng: -0.0392 },
  accessible: true,
  allGender: null,
  men: true,
  women: true,
  children: null,
  babyChange: true,
  radar: true,
  automatic: false,
  noPayment: true,
  paymentDetails: null,
  openingTimes: [
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["10:00", "16:00"],
    [],
  ],
  updatedAt: "2026-10-01T12:00:00.000Z",
  active: true,
  area: [{ name: "Tower Hamlets", type: "London Borough" }],
  ...overrides,
});

describe("looTitle / looDescription", () => {
  it("names the toilet and its area", () => {
    expect(looTitle(loo())).toBe("Victoria Park, Tower Hamlets – Toilet Map");
  });

  it("doesn't repeat an area already in the name", () => {
    expect(looTitle(loo({ name: "Tower Hamlets Library" }))).toBe(
      "Tower Hamlets Library – Toilet Map",
    );
  });

  it("gives an unnamed toilet a generic name", () => {
    expect(looDisplayName({ name: "  " })).toBe("Public toilet");
    expect(looTitle(loo({ name: null, area: [] }))).toBe("Public toilet – Toilet Map");
  });

  it("describes the known facilities, whether it's free and the hours", () => {
    const text = looDescription(loo());
    expect(text).toContain("Public toilet in Tower Hamlets");
    expect(text).toContain("accessible");
    expect(text).toContain("RADAR key");
    expect(text).toContain("baby changing");
    expect(text).toContain("free to use");
    expect(text).toContain("Opening hours: Mon–Fri 9am–5pm · Sat 10am–4pm · Sun closed.");
    // Unknown facilities are not claimed either way.
    expect(text).not.toContain("all-gender");
    expect(text.length).toBeLessThanOrEqual(300);
  });

  it("says when the hours are not known", () => {
    expect(looDescription(loo({ openingTimes: null }))).toContain("Opening hours not known.");
  });

  it("marks a removed toilet as removed", () => {
    const removed = loo({ active: false });
    expect(looTitle(removed)).toBe("Removed: Victoria Park, Tower Hamlets – Toilet Map");
    expect(looDescription(removed)).toContain("has been removed from the Toilet Map");
  });
});

describe("looPageHeading", () => {
  it("names the toilet and says what it is", () => {
    expect(looPageHeading(loo())).toBe("Victoria Park, Tower Hamlets: public toilet");
  });

  it("doesn't repeat 'toilet' when the name says it", () => {
    expect(looPageHeading(loo({ name: null, area: [] }))).toBe("Public toilet");
    expect(looPageHeading(loo({ name: "Market Street Toilets" }))).toBe(
      "Market Street Toilets, Tower Hamlets",
    );
  });

  it("marks a removed toilet", () => {
    expect(looPageHeading(loo({ active: false }))).toBe(
      "Victoria Park, Tower Hamlets: public toilet (removed)",
    );
  });
});

describe("openingHoursSpecification", () => {
  it("is null when the hours are not known", () => {
    expect(openingHoursSpecification(null)).toBeNull();
  });

  it("groups days with the same hours and leaves closed days out", () => {
    expect(openingHoursSpecification(loo().openingTimes)).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "https://schema.org/Monday",
          "https://schema.org/Tuesday",
          "https://schema.org/Wednesday",
          "https://schema.org/Thursday",
          "https://schema.org/Friday",
        ],
        opens: "09:00",
        closes: "17:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["https://schema.org/Saturday"],
        opens: "10:00",
        closes: "16:00",
      },
    ]);
  });

  it("writes 24-hour days as 00:00–23:59 and keeps overnight ranges", () => {
    const specs = openingHoursSpecification([
      ["00:00", "00:00"],
      ["00:00", "24:00"],
      ["22:00", "06:00"],
      ["08:00", "24:00"],
      [],
      [],
      [],
    ]);
    expect(specs).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["https://schema.org/Monday", "https://schema.org/Tuesday"],
        opens: "00:00",
        closes: "23:59",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["https://schema.org/Wednesday"],
        opens: "22:00",
        closes: "06:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["https://schema.org/Thursday"],
        opens: "08:00",
        closes: "23:59",
      },
    ]);
  });
});

describe("looJsonLd", () => {
  const url = `${SITE}/loos/${ID}`;

  type Node = Record<string, unknown>;
  const graph = (data: Node | null) => (data?.["@graph"] ?? []) as Node[];
  const node = (data: Node | null, type: string) =>
    graph(data).find((entry) => entry["@type"] === type) as Node;
  /** The PublicToilet node. */
  const toilet = (data: Node | null) => node(data, "PublicToilet");

  /** Properties schema.org defines for PublicToilet (Place, CivicStructure, Thing). */
  const PLACE_PROPERTIES = new Set([
    "@type",
    "@id",
    "name",
    "url",
    "description",
    "publicAccess",
    "geo",
    "address",
    "amenityFeature",
    "isAccessibleForFree",
    "openingHoursSpecification",
    "openingHours",
  ]);

  it("is a schema.org PublicToilet with location, facilities, price and hours", () => {
    const outer = looJsonLd(loo(), url) as Node;
    expect(outer["@context"]).toBe("https://schema.org");
    const data = toilet(outer);
    expect(data["@type"]).toBe("PublicToilet");
    expect(data["@id"]).toBe(`${url}#toilet`);
    expect(data.url).toBe(url);
    expect(data.name).toBe("Victoria Park");
    expect(data.geo).toEqual({ "@type": "GeoCoordinates", latitude: 51.5362, longitude: -0.0392 });
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Tower Hamlets",
      addressCountry: "GB",
    });
    expect(data.isAccessibleForFree).toBe(true);
    expect(data.amenityFeature).toContainEqual({
      "@type": "LocationFeatureSpecification",
      name: "Wheelchair accessible",
      value: true,
    });
    // A known "no" is stated; unknowns are left out.
    expect(data.amenityFeature).toContainEqual({
      "@type": "LocationFeatureSpecification",
      name: "Automatic",
      value: false,
    });
    const names = (data.amenityFeature as { name: string }[]).map((feature) => feature.name);
    expect(names).not.toContain("All-gender");
    expect(names).not.toContain("Children's toilets");
    expect(data.openingHoursSpecification).toHaveLength(2);
  });

  it("gives the PublicToilet only Place properties; page facts go on a WebPage node", () => {
    const outer = looJsonLd(loo({ noPayment: false, paymentDetails: "20p" }), url) as Node;
    for (const key of Object.keys(toilet(outer))) {
      expect(PLACE_PROPERTIES.has(key), key).toBe(true);
    }
    expect(toilet(outer).dateModified).toBeUndefined();
    expect(toilet(outer).isPartOf).toBeUndefined();
    expect(toilet(outer).priceRange).toBeUndefined();

    const page = node(outer, "WebPage");
    expect(page["@id"]).toBe(url);
    expect(page.url).toBe(url);
    expect(page.name).toBe("Victoria Park, Tower Hamlets – Toilet Map");
    expect(page.dateModified).toBe("2026-10-01T12:00:00.000Z");
    expect(page.isPartOf).toEqual({ "@type": "WebSite", name: "Toilet Map", url: `${SITE}/` });
    expect(page.mainEntity).toEqual({ "@id": `${url}#toilet` });
  });

  it("leaves out what is not known", () => {
    const data = toilet(
      looJsonLd(loo({ location: null, area: [], openingTimes: null, noPayment: null }), url),
    );
    expect(data.geo).toBeUndefined();
    expect(data.address).toBeUndefined();
    expect(data.openingHoursSpecification).toBeUndefined();
    expect(data.isAccessibleForFree).toBeUndefined();
  });

  it("gives the price details of a toilet that charges", () => {
    const data = toilet(looJsonLd(loo({ noPayment: false, paymentDetails: "20p" }), url));
    expect(data.isAccessibleForFree).toBe(false);
    expect(data.amenityFeature).toContainEqual({
      "@type": "LocationFeatureSpecification",
      name: "Payment",
      value: "20p",
    });
  });

  it("is null for a removed toilet", () => {
    expect(looJsonLd(loo({ active: false }), url)).toBeNull();
  });

  it("stays safe to inline when the name contains markup", () => {
    const data = looJsonLd(loo({ name: "</script><img src=x onerror=alert(1)>" }), url);
    const json = serializeJsonLd(data);
    expect(json).not.toContain("</script>");
    expect(toilet(JSON.parse(json)).name).toBe("</script><img src=x onerror=alert(1)>");
  });
});

describe("looPageMeta", () => {
  it("has a canonical on the production site and is indexable", () => {
    const meta = looPageMeta(loo(), SITE);
    expect(meta.canonical).toBe(`${SITE}/loos/${ID}`);
    expect(meta.noindex).toBe(false);
    const graph = (meta.jsonLd?.["@graph"] ?? []) as { "@type": string }[];
    expect(graph.map((n) => n["@type"])).toEqual(["WebPage", "PublicToilet"]);
  });

  it("is noindex, without JSON-LD or a canonical, for a removed toilet", () => {
    const meta = looPageMeta(loo({ active: false }), SITE);
    expect(meta.noindex).toBe(true);
    expect(meta.jsonLd).toBeNull();
    expect(meta.canonical).toBeUndefined();
  });
});
