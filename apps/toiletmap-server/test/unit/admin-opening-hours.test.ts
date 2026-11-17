import { describe, expect, it } from "vitest";
import { OpeningHours } from "../../src/admin/components/OpeningHours";
import {
  copyDayTo,
  createAllDayWeek,
  createDefaultWeek,
  isOpen24Every,
  isTwentyFourHours,
  normaliseWeek,
  type OpeningWeek,
  summariseOpeningTimes,
  validateOpeningTimes,
} from "../../src/admin/pages/loos/shared/utils/opening-hours";
import type { OpeningTimes } from "../../src/services/loo/types";

const weekdayHours: OpeningWeek = [
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["10:00", "16:00"],
  [],
];

const renderHtml = async (openingTimes: OpeningTimes, now?: Date) =>
  String(await OpeningHours({ openingTimes, now }).toString());

describe("admin opening-hours utils (shared package)", () => {
  it("builds the default and 24/7 weeks", () => {
    expect(createDefaultWeek()).toEqual(Array.from({ length: 7 }, () => ["09:00", "17:00"]));
    expect(isOpen24Every(createAllDayWeek())).toBe(true);
  });

  it("treats any equal pair as 24 hours", () => {
    expect(isTwentyFourHours(["00:00", "00:00"])).toBe(true);
    expect(isTwentyFourHours(["12:00", "12:00"])).toBe(true);
    expect(isTwentyFourHours([])).toBe(false);
  });

  it("normalises and copies days without mutating the input", () => {
    expect(normaliseWeek([["09:00", "17:00"]] as OpeningWeek)).toHaveLength(7);
    const next = copyDayTo(weekdayHours, 0, [5, 6]);
    expect(next[6]).toEqual(["09:00", "17:00"]);
    expect(next[6]).not.toBe(next[0]);
    expect(weekdayHours[6]).toEqual([]);
  });

  it("summarises and validates the server's opening-times type", () => {
    expect(summariseOpeningTimes(weekdayHours)).toBe("Mon–Fri 9am–5pm · Sat 10am–4pm · Sun closed");
    expect(summariseOpeningTimes(null)).toBe("Opening hours not known");
    expect(validateOpeningTimes(weekdayHours)).toBeNull();
    const broken = [...weekdayHours] as OpeningWeek;
    broken[2] = ["09:00", ""];
    expect(validateOpeningTimes(broken)).toBe(
      "Enter both opening and closing times for Wednesday.",
    );
  });
});

describe("admin <OpeningHours>", () => {
  it("shows Unknown for null and Closed when every day is closed", async () => {
    expect(await renderHtml(null)).toContain("Unknown");
    expect(await renderHtml(Array.from({ length: 7 }, () => []) as OpeningWeek)).toContain(
      "Closed",
    );
  });

  it("shows the summary and plain-English ranges, with 24 hours spelled out", async () => {
    const hours = [...weekdayHours] as OpeningWeek;
    hours[6] = ["00:00", "00:00"];
    const html = await renderHtml(hours, new Date("2026-11-16T12:00:00Z"));
    expect(html).toContain("Mon–Fri 9am–5pm · Sat 10am–4pm · Sun open 24 hours");
    expect(html).toContain("9am–5pm");
    expect(html).toContain("Open 24 hours");
    expect(html).not.toContain("00:00");
  });

  it("highlights today in Europe/London time, not UTC", async () => {
    // 23:30 UTC on Sunday 5 July 2026 is 00:30 on Monday in London (BST).
    const html = await renderHtml(weekdayHours, new Date("2026-07-05T23:30:00Z"));
    const monday = html.slice(html.indexOf("<li"), html.indexOf("</li>"));
    expect(monday).toContain("Monday");
    expect(monday).toContain("font-weight:600");
    const sunday = html.slice(html.lastIndexOf("<li"));
    expect(sunday).toContain("Sunday");
    expect(sunday).not.toContain("font-weight:600");
  });
});
