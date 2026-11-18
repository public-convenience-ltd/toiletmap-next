import { describe, expect, it } from "vitest";
import type { LooDetail } from "../../api/loos";
import {
  directionsUrl,
  distanceText,
  formatDistance,
  haversineMetres,
  isApplePlatform,
  isUniformWeek,
  keyFeatures,
  openStatus,
  paymentText,
  splitFacilities,
} from "./format";

describe("haversineMetres", () => {
  it("is zero for the same point and symmetric", () => {
    const a = { lat: 51.5, lng: -0.14 };
    const b = { lat: 51.51, lng: -0.12 };
    expect(haversineMetres(a, a)).toBe(0);
    expect(haversineMetres(a, b)).toBeCloseTo(haversineMetres(b, a), 6);
  });

  it("matches known distances", () => {
    // One degree of latitude is about 111.2 km.
    expect(haversineMetres({ lat: 51, lng: 0 }, { lat: 52, lng: 0 })).toBeCloseTo(111_195, -2);
    // London to Edinburgh, about 534 km.
    const km =
      haversineMetres({ lat: 51.5074, lng: -0.1278 }, { lat: 55.9533, lng: -3.1883 }) / 1000;
    expect(km).toBeGreaterThan(530);
    expect(km).toBeLessThan(538);
  });
});

describe("formatDistance", () => {
  it.each([
    [0, "10 m"],
    [4, "10 m"],
    [44, "40 m"],
    [349, "350 m"],
    [994, "990 m"],
    [995, "1.0 km"],
    [1_249, "1.2 km"],
    [9_940, "9.9 km"],
    [9_960, "10 km"],
    [14_400, "14 km"],
  ])("%d m → %s", (metres, text) => {
    expect(formatDistance(metres)).toBe(text);
  });

  it("is empty for nonsense", () => {
    expect(formatDistance(Number.NaN)).toBe("");
    expect(formatDistance(-1)).toBe("");
  });
});

describe("distanceText", () => {
  it("needs both ends", () => {
    expect(distanceText(null, { lat: 51.5, lng: 0 })).toBeNull();
    expect(distanceText({ lat: 51.5, lng: 0 }, null)).toBeNull();
    expect(distanceText({ lat: Number.NaN, lng: 0 }, { lat: 51.5, lng: 0 })).toBeNull();
    expect(distanceText({ lat: 51.5, lng: -0.145 }, { lat: 51.5, lng: -0.14 })).toBe("350 m away");
  });
});

describe("directionsUrl", () => {
  const at = { lat: 51.5, lng: -0.14 };
  const apple = "https://maps.apple.com/?daddr=51.5,-0.14&dirflg=w";
  const google = "https://www.google.com/maps/dir/?api=1&destination=51.5,-0.14&travelmode=walking";

  it.each([
    [
      "iPhone",
      { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone" },
      apple,
    ],
    [
      "iPadOS (reports a Mac)",
      { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel" },
      apple,
    ],
    ["macOS by platform only", { userAgent: "", platform: "MacIntel" }, apple],
    [
      "Android",
      { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 7)", platform: "Linux armv81" },
      google,
    ],
    [
      "Windows",
      { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32" },
      google,
    ],
    ["unknown", {}, google],
  ])("%s", (_name, info, url) => {
    expect(directionsUrl(at, info)).toBe(url);
  });

  it("detects Apple platforms", () => {
    expect(isApplePlatform({ platform: "iPad" })).toBe(true);
    expect(isApplePlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
  });
});

describe("openStatus", () => {
  const every = (day: [string, string] | []) =>
    Array.from({ length: 7 }, () => day) as LooDetail["openingTimes"];
  // Tuesday 17 Nov 2026, London = UTC (GMT).
  const tuesday = (time: string) => new Date(`2026-11-17T${time}:00Z`);

  it.each([
    [
      "open with a close time",
      every(["09:00", "18:00"]),
      tuesday("12:00"),
      "open",
      "Open now · closes 6pm",
    ],
    [
      "closed, opens later today",
      every(["09:00", "18:00"]),
      tuesday("07:00"),
      "closed",
      "Closed · opens 9am",
    ],
    [
      "closed, opens tomorrow",
      every(["09:00", "18:00"]),
      tuesday("19:00"),
      "closed",
      "Closed · opens 9am tomorrow",
    ],
    [
      "open 24 hours every day",
      every(["00:00", "00:00"]),
      tuesday("03:00"),
      "open",
      "Open 24 hours",
    ],
    [
      "overnight, before midnight",
      every(["20:00", "04:00"]),
      tuesday("23:00"),
      "open",
      "Open now · closes 4am",
    ],
    [
      "overnight, after midnight",
      every(["20:00", "04:00"]),
      tuesday("02:00"),
      "open",
      "Open now · closes 4am",
    ],
    ["closed every day", every([]), tuesday("12:00"), "closed", "Closed"],
    ["unknown", null, tuesday("12:00"), "unknown", "Hours not known"],
  ] as const)("%s", (_name, hours, now, tone, text) => {
    expect(openStatus(hours as LooDetail["openingTimes"], now)).toEqual({ tone, text });
  });

  it("uses London time in summer (BST)", () => {
    // 08:30 UTC on 7 July 2026 is 09:30 in London.
    expect(openStatus(every(["09:00", "17:00"]), new Date("2026-07-07T08:30:00Z")).text).toBe(
      "Open now · closes 5pm",
    );
  });
});

const base: LooDetail = {
  id: "x",
  name: null,
  location: null,
  accessible: null,
  allGender: null,
  men: null,
  women: null,
  children: null,
  babyChange: null,
  radar: null,
  automatic: null,
  noPayment: null,
  paymentDetails: null,
  openingTimes: null,
  updatedAt: null,
};

describe("keyFeatures", () => {
  it("lists only the features that are there, in a fixed order", () => {
    expect(keyFeatures(base)).toEqual([]);
    expect(keyFeatures({ ...base, accessible: false, radar: false })).toEqual([]);
    const all = keyFeatures({
      ...base,
      accessible: true,
      babyChange: true,
      radar: true,
      noPayment: true,
      allGender: true,
    });
    expect(all.map((f) => [f.label, f.icon])).toEqual([
      ["Accessible", "wheelchair-move"],
      ["Baby changing", "baby"],
      ["RADAR key", "key"],
      // The toilet icon: person-dress is the women's icon.
      ["All-gender", "toilet"],
    ]);
  });

  it("leaves payment to its text chip: one £ icon read as paid even when free", () => {
    expect(keyFeatures({ ...base, noPayment: true })).toEqual([]);
    expect(keyFeatures({ ...base, noPayment: false })).toEqual([]);
  });
});

describe("paymentText", () => {
  it.each([
    [{ noPayment: true, paymentDetails: "ignored" }, "Free"],
    [{ noPayment: false, paymentDetails: null }, "Paid"],
    [{ noPayment: false, paymentDetails: "  " }, "Paid"],
    [{ noPayment: false, paymentDetails: " 20p " }, "Paid: 20p"],
    [{ noPayment: null, paymentDetails: "20p" }, null],
  ] as const)("%j → %s", (fields, text) => {
    expect(paymentText(fields)).toBe(text);
  });
});

describe("isUniformWeek", () => {
  const week = (day: string[]) => Array.from({ length: 7 }, () => [...day]);

  it("is true when all seven days have the same hours", () => {
    expect(isUniformWeek(week(["09:00", "17:00"]))).toBe(true);
    expect(isUniformWeek(week(["00:00", "00:00"]))).toBe(true);
    // Any 24-hour pair counts as the same.
    expect(isUniformWeek([...week(["00:00", "00:00"]).slice(0, 6), ["00:00", "24:00"]])).toBe(true);
    expect(isUniformWeek(week([]))).toBe(true);
  });

  it("is false for a varied, partly known or missing week", () => {
    expect(isUniformWeek([...week(["09:00", "17:00"]).slice(0, 6), []])).toBe(false);
    expect(isUniformWeek(week(["09:00", "17:00"]).slice(0, 6))).toBe(false);
    const gap: (string[] | undefined)[] = week(["09:00", "17:00"]);
    gap[3] = undefined;
    expect(isUniformWeek(gap)).toBe(false);
    expect(isUniformWeek(null)).toBe(false);
    expect(isUniformWeek(undefined)).toBe(false);
  });
});

describe("splitFacilities", () => {
  it("splits yes / no answers from the unknown ones, payment included", () => {
    const { known, unknown } = splitFacilities({
      ...base,
      accessible: true,
      men: false,
      allGender: true,
    });
    expect(known.map((f) => [f.label, f.icon, f.value])).toEqual([
      ["Accessible", "wheelchair-move", true],
      ["All-gender", "toilet", true],
      ["Men", "person", false],
    ]);
    expect(unknown).toEqual([
      "Women",
      "Children",
      "Baby changing",
      "RADAR key",
      "Automatic",
      "Payment",
    ]);
  });

  it("counts payment as known when it's free or paid", () => {
    expect(splitFacilities({ ...base, noPayment: false }).unknown).not.toContain("Payment");
  });
});
