import { describe, expect, it } from "vitest";
import {
  allDay24,
  copyDayTo,
  createDefaultOpeningTimes,
  DAYS,
  type DayHours,
  formatRange,
  formatTime,
  is24h,
  isClosedDay,
  isOpen24Every,
  isOpenNow,
  isOvernight,
  isTwentyFourHours,
  isValidTime,
  londonClock,
  normaliseOpeningTimes,
  type OpeningTimes,
  sameDay,
  sameEveryDay,
  summariseOpeningTimes,
  validateDay,
  validateOpeningTimes,
  weekdaysAndWeekends,
} from "./index";

const week = (day: DayHours): OpeningTimes => DAYS.map(() => [...day] as DayHours);

/** Builds a week from Monday-first entries. */
const days = (...entries: DayHours[]): OpeningTimes => {
  if (entries.length !== 7) throw new Error("need 7 days");
  return entries;
};

describe("DAYS", () => {
  it("lists Monday to Sunday", () => {
    expect(DAYS).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });
});

describe("is24h / isClosedDay / isOvernight", () => {
  it("treats any equal non-empty pair as 24 hours", () => {
    expect(is24h(["00:00", "00:00"])).toBe(true);
    expect(is24h(["12:00", "12:00"])).toBe(true);
    expect(is24h(["24:00", "24:00"])).toBe(true);
    expect(isTwentyFourHours(["07:30", "07:30"])).toBe(true);
  });

  it("treats 00:00–24:00 (midnight to midnight) as 24 hours", () => {
    expect(is24h(["00:00", "24:00"])).toBe(true);
    expect(isOvernight(["00:00", "24:00"])).toBe(false);
    expect(is24h(["24:00", "00:00"])).toBe(false);
    expect(is24h(["00:00", "23:59"])).toBe(false);
    expect(is24h(["06:00", "24:00"])).toBe(false);
  });

  it("is false for closed days, empty strings and normal ranges", () => {
    expect(is24h([])).toBe(false);
    expect(is24h(["", ""])).toBe(false);
    expect(is24h(["09:00", "17:00"])).toBe(false);
    expect(is24h(null)).toBe(false);
    expect(is24h(undefined)).toBe(false);
  });

  it("identifies closed days", () => {
    expect(isClosedDay([])).toBe(true);
    expect(isClosedDay(["09:00", "17:00"])).toBe(false);
    expect(isClosedDay(["00:00", "00:00"])).toBe(false);
    expect(isClosedDay(null)).toBe(false);
  });

  it("identifies overnight ranges, but not ranges ending at midnight", () => {
    expect(isOvernight(["22:00", "06:00"])).toBe(true);
    expect(isOvernight(["18:00", "01:30"])).toBe(true);
    expect(isOvernight(["22:00", "00:00"])).toBe(false);
    expect(isOvernight(["22:00", "24:00"])).toBe(false);
    expect(isOvernight(["09:00", "17:00"])).toBe(false);
    expect(isOvernight(["00:00", "00:00"])).toBe(false);
    expect(isOvernight([])).toBe(false);
    expect(isOvernight(["22:00", ""])).toBe(false);
  });
});

describe("isValidTime", () => {
  it("accepts HH:mm between 00:00 and 24:00", () => {
    for (const ok of ["00:00", "09:05", "12:00", "23:59", "24:00"]) {
      expect(isValidTime(ok)).toBe(true);
    }
  });

  it("rejects malformed and out-of-range values", () => {
    for (const bad of ["9:00", "24:30", "25:00", "12:60", "noon", "", null, 900]) {
      expect(isValidTime(bad)).toBe(false);
    }
  });
});

describe("validateDay", () => {
  it("accepts closed days, ranges, overnight and 24 hours", () => {
    expect(validateDay([])).toBeNull();
    expect(validateDay(["09:00", "17:00"])).toBeNull();
    expect(validateDay(["22:00", "06:00"])).toBeNull();
    expect(validateDay(["00:00", "00:00"])).toBeNull();
    expect(validateDay(["06:30", "24:00"])).toBeNull();
  });

  it("names the day when one is given", () => {
    expect(validateDay(["09:00", ""], "Tuesday")).toBe(
      "Enter both opening and closing times for Tuesday.",
    );
    expect(validateDay(["09:00", "25:00"], "Sunday")).toBe(
      "Enter times for Sunday as HH:MM, between 00:00 and 24:00.",
    );
    expect(validateDay("open", "Friday")).toBe(
      "Enter opening hours for Friday, or mark it as closed.",
    );
  });

  it("gives a generic message without a day name", () => {
    expect(validateDay(["", "17:00"])).toBe("Enter both opening and closing times.");
    expect(validateDay(["9am", "5pm"])).toBe("Enter times as HH:MM, between 00:00 and 24:00.");
    expect(validateDay(null)).toBe("Enter opening hours, or mark the day as closed.");
  });

  it("rejects a day with a single time or too many times", () => {
    expect(validateDay(["09:00"], "Monday")).toMatch(/Monday/);
    expect(validateDay(["09:00", "12:00", "17:00"], "Monday")).toMatch(/Monday/);
  });
});

describe("validateOpeningTimes", () => {
  it("accepts null (hours not known)", () => {
    expect(validateOpeningTimes(null)).toBeNull();
  });

  it("accepts a mixed week with closed days, 24 hours and overnight ranges", () => {
    expect(
      validateOpeningTimes(
        days(
          ["09:00", "17:00"],
          [],
          ["00:00", "00:00"],
          ["12:00", "12:00"],
          ["22:00", "02:00"],
          ["06:30", "24:00"],
          [],
        ),
      ),
    ).toBeNull();
    expect(validateOpeningTimes(createDefaultOpeningTimes())).toBeNull();
  });

  it("requires exactly seven days", () => {
    expect(validateOpeningTimes(week([]).slice(0, 6))).toBe(
      "Opening hours must include all seven days.",
    );
    expect(validateOpeningTimes([...week([]), []])).toMatch(/seven days/);
  });

  it("names the first invalid day", () => {
    const value = week(["09:00", "17:00"]);
    value[1] = ["09:00", ""];
    value[3] = ["", ""];
    expect(validateOpeningTimes(value)).toBe("Enter both opening and closing times for Tuesday.");
  });

  it("names the day by its label when labels are given (grouped rows)", () => {
    const value = week(["09:00", "17:00"]);
    value[0] = ["09:00", ""];
    const labels = [
      ...Array(5).fill("Monday to Friday"),
      "Saturday and Sunday",
      "Saturday and Sunday",
    ];
    expect(validateOpeningTimes(value, { dayLabels: labels })).toBe(
      "Enter both opening and closing times for Monday to Friday.",
    );
    value[0] = ["09:00", "17:00"];
    value[6] = ["", "17:00"];
    expect(validateOpeningTimes(value, { dayLabels: labels })).toBe(
      "Enter both opening and closing times for Saturday and Sunday.",
    );
    // Missing or empty labels fall back to the day name.
    expect(validateOpeningTimes(value, { dayLabels: ["Every day"] })).toBe(
      "Enter both opening and closing times for Sunday.",
    );
  });

  it("rejects malformed times naming the day", () => {
    for (const bad of ["9:00", "24:30", "25:00", "12:60", "noon"]) {
      const value = week(["09:00", "17:00"]);
      value[6] = ["09:00", bad];
      expect(validateOpeningTimes(value)).toBe(
        "Enter times for Sunday as HH:MM, between 00:00 and 24:00.",
      );
    }
  });
});

describe("presets", () => {
  it("sameEveryDay copies the range into seven independent days", () => {
    const value = sameEveryDay(["08:00", "18:00"]);
    expect(value).toEqual(week(["08:00", "18:00"]));
    expect(value[0]).not.toBe(value[1]);
    expect(sameEveryDay([])).toEqual(week([]));
  });

  it("weekdaysAndWeekends splits Mon–Fri from Sat–Sun", () => {
    expect(weekdaysAndWeekends(["09:00", "17:00"], ["10:00", "16:00"])).toEqual(
      days(
        ["09:00", "17:00"],
        ["09:00", "17:00"],
        ["09:00", "17:00"],
        ["09:00", "17:00"],
        ["09:00", "17:00"],
        ["10:00", "16:00"],
        ["10:00", "16:00"],
      ),
    );
    expect(weekdaysAndWeekends(["07:00", "19:00"], [])).toEqual([
      ...week(["07:00", "19:00"]).slice(0, 5),
      [],
      [],
    ]);
  });

  it("allDay24 is 00:00–00:00 every day", () => {
    expect(allDay24()).toEqual(week(["00:00", "00:00"]));
    expect(isOpen24Every(allDay24())).toBe(true);
  });

  it("createDefaultOpeningTimes is 09:00–17:00 every day", () => {
    expect(createDefaultOpeningTimes()).toEqual(week(["09:00", "17:00"]));
  });
});

describe("helpers", () => {
  it("normaliseOpeningTimes pads and repairs to seven days", () => {
    expect(normaliseOpeningTimes([["09:00", "17:00"]])).toEqual([
      ["09:00", "17:00"],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(normaliseOpeningTimes([null, undefined] as never)).toEqual(week([]));
  });

  it("copyDayTo copies without mutating or sharing arrays", () => {
    const value = days(["08:00", "20:00"], [], [], [], [], [], ["10:00", "16:00"]);
    const next = copyDayTo(value, 0, [1, 2, 3, 4]);
    expect(next.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => ["08:00", "20:00"]));
    expect(next[1]).not.toBe(next[0]);
    expect(next[6]).toEqual(["10:00", "16:00"]);
    expect(value[1]).toEqual([]);
  });

  it("sameDay treats all 24-hour pairs as equal", () => {
    expect(sameDay(["00:00", "00:00"], ["12:00", "12:00"])).toBe(true);
    expect(sameDay(["09:00", "17:00"], ["09:00", "17:00"])).toBe(true);
    expect(sameDay(["09:00", "17:00"], ["09:00", "17:30"])).toBe(false);
    expect(sameDay([], [])).toBe(true);
    expect(sameDay([], ["09:00", "17:00"])).toBe(false);
  });

  it("isOpen24Every needs all seven days at 24 hours", () => {
    expect(isOpen24Every(null)).toBe(false);
    const value = allDay24();
    value[6] = [];
    expect(isOpen24Every(value)).toBe(false);
  });
});

describe("formatTime", () => {
  it.each([
    ["09:00", "9am"],
    ["13:30", "1:30pm"],
    ["00:00", "midnight"],
    ["24:00", "midnight"],
    ["12:00", "midday"],
    ["12:30", "12:30pm"],
    ["00:15", "12:15am"],
    ["23:59", "11:59pm"],
    ["07:05", "7:05am"],
    ["17:00", "5pm"],
  ])("%s → %s", (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });

  it("never throws on bad input", () => {
    expect(formatTime("")).toBe("?");
    expect(formatTime("9:00")).toBe("9:00");
  });
});

describe("formatRange", () => {
  it("formats ranges, overnight, 24 hours and closed", () => {
    expect(formatRange(["09:00", "17:00"])).toBe("9am–5pm");
    expect(formatRange(["22:00", "06:00"])).toBe("10pm–6am");
    expect(formatRange(["00:00", "00:00"])).toBe("Open 24 hours");
    expect(formatRange(["12:00", "12:00"])).toBe("Open 24 hours");
    expect(formatRange([])).toBe("Closed");
    expect(formatRange(null)).toBe("Closed");
    expect(formatRange(["06:30", "24:00"])).toBe("6:30am–midnight");
    expect(formatRange(["00:00", "24:00"])).toBe("Open 24 hours");
  });

  it("sameDay treats 00:00–24:00 like any other 24-hour pair", () => {
    expect(sameDay(["00:00", "24:00"], ["00:00", "00:00"])).toBe(true);
    expect(sameDay(["00:00", "24:00"], ["00:00", "23:00"])).toBe(false);
  });
});

describe("summariseOpeningTimes", () => {
  it("says when hours are not known", () => {
    expect(summariseOpeningTimes(null)).toBe("Opening hours not known");
    expect(summariseOpeningTimes(undefined)).toBe("Opening hours not known");
  });

  it("summarises open 24 hours every day (any equal pair)", () => {
    expect(summariseOpeningTimes(allDay24())).toBe("Open 24 hours, every day");
    const mixedPairs = allDay24();
    mixedPairs[3] = ["12:00", "12:00"];
    expect(summariseOpeningTimes(mixedPairs)).toBe("Open 24 hours, every day");
    expect(summariseOpeningTimes(week(["00:00", "24:00"]))).toBe("Open 24 hours, every day");
    expect(isOpen24Every(week(["00:00", "24:00"]))).toBe(true);
    const mixed = week(["09:00", "17:00"]);
    mixed[5] = ["00:00", "24:00"];
    mixed[6] = ["00:00", "00:00"];
    expect(summariseOpeningTimes(mixed)).toBe("Mon–Fri 9am–5pm · Sat–Sun open 24 hours");
  });

  it("summarises closed every day and the same hours every day", () => {
    expect(summariseOpeningTimes(week([]))).toBe("Closed every day");
    expect(summariseOpeningTimes(week(["09:00", "17:00"]))).toBe("Every day 9am–5pm");
  });

  it("groups consecutive identical days", () => {
    expect(
      summariseOpeningTimes([
        ...week(["09:00", "17:00"]).slice(0, 5),
        ["10:00", "16:00"],
        [],
      ]),
    ).toBe("Mon–Fri 9am–5pm · Sat 10am–4pm · Sun closed");
    expect(summariseOpeningTimes(weekdaysAndWeekends(["08:00", "18:00"], []))).toBe(
      "Mon–Fri 8am–6pm · Sat–Sun closed",
    );
  });

  it("does not group days that are equal but not consecutive", () => {
    expect(
      summariseOpeningTimes(
        days(["09:00", "17:00"], [], ["09:00", "17:00"], [], [], [], []),
      ),
    ).toBe("Mon 9am–5pm · Tue closed · Wed 9am–5pm · Thu–Sun closed");
  });

  it("includes overnight and 24-hour groups", () => {
    expect(
      summariseOpeningTimes(
        days(
          ["00:00", "00:00"],
          ["00:00", "00:00"],
          ["06:00", "22:00"],
          ["06:00", "22:00"],
          ["22:00", "06:00"],
          ["22:00", "06:00"],
          [],
        ),
      ),
    ).toBe("Mon–Tue open 24 hours · Wed–Thu 6am–10pm · Fri–Sat 10pm–6am · Sun closed");
  });

  it("copes with a short array", () => {
    expect(summariseOpeningTimes([["09:00", "17:00"]])).toBe("Mon 9am–5pm · Tue–Sun closed");
  });
});

// Fixed instants. 2026-11-16 and 2026-01-12 are Mondays in GMT (UTC+0);
// 2026-07-06 is a Monday in BST (UTC+1).
const gmt = (isoLocal: string) => new Date(`${isoLocal}Z`);
const bst = (isoLocal: string) => new Date(`${isoLocal}+01:00`);

describe("londonClock", () => {
  it("reads Europe/London wall time in GMT and BST", () => {
    expect(londonClock(gmt("2026-11-16T09:30:00"))).toEqual({ dayIndex: 0, minutes: 570 });
    expect(londonClock(new Date("2026-07-06T08:30:00Z"))).toEqual({ dayIndex: 0, minutes: 570 });
    // 23:30 UTC on Sunday 5 July is 00:30 on Monday in London.
    expect(londonClock(new Date("2026-07-05T23:30:00Z"))).toEqual({ dayIndex: 0, minutes: 30 });
  });

  it("follows the clock changes", () => {
    // Clocks go forward at 01:00 UTC on Sunday 29 March 2026.
    expect(londonClock(new Date("2026-03-29T00:59:00Z")).minutes).toBe(59);
    expect(londonClock(new Date("2026-03-29T01:00:00Z")).minutes).toBe(120);
    // Clocks go back at 01:00 UTC on Sunday 25 October 2026.
    expect(londonClock(new Date("2026-10-25T00:30:00Z")).minutes).toBe(90);
    expect(londonClock(new Date("2026-10-25T01:30:00Z")).minutes).toBe(90);
  });
});

describe("isOpenNow", () => {
  const nineToFive = week(["09:00", "17:00"]);

  it("is unknown when hours are not known or malformed", () => {
    expect(isOpenNow(null, gmt("2026-11-16T12:00:00"))).toEqual({ state: "unknown" });
    expect(isOpenNow([["09:00", "17:00"]], gmt("2026-11-16T12:00:00"))).toEqual({
      state: "unknown",
    });
  });

  it("is open inside a range, with the closing time", () => {
    expect(isOpenNow(nineToFive, gmt("2026-11-16T12:00:00"))).toEqual({
      state: "open",
      closesAt: "5pm",
    });
  });

  it("opens exactly at the opening time and closes exactly at the closing time", () => {
    expect(isOpenNow(nineToFive, gmt("2026-11-16T09:00:00")).state).toBe("open");
    expect(isOpenNow(nineToFive, gmt("2026-11-16T08:59:00"))).toEqual({
      state: "closed",
      opensAt: "9am",
    });
    expect(isOpenNow(nineToFive, gmt("2026-11-16T16:59:00")).state).toBe("open");
    expect(isOpenNow(nineToFive, gmt("2026-11-16T17:00:00"))).toEqual({
      state: "closed",
      opensAt: "9am tomorrow",
    });
  });

  it("uses London local time in summer (BST) and winter (GMT)", () => {
    // 08:30 UTC is 09:30 BST: open.
    expect(isOpenNow(nineToFive, new Date("2026-07-06T08:30:00Z")).state).toBe("open");
    expect(isOpenNow(nineToFive, bst("2026-07-06T09:30:00")).state).toBe("open");
    // 08:30 UTC is 08:30 GMT: not yet open.
    expect(isOpenNow(nineToFive, new Date("2026-01-12T08:30:00Z"))).toEqual({
      state: "closed",
      opensAt: "9am",
    });
    // 16:30 UTC is 17:30 BST: closed.
    expect(isOpenNow(nineToFive, new Date("2026-07-06T16:30:00Z")).state).toBe("closed");
    // 16:30 UTC is 16:30 GMT: still open.
    expect(isOpenNow(nineToFive, new Date("2026-01-12T16:30:00Z")).state).toBe("open");
  });

  it("is open all day on a 24-hour day, continuing into another 24-hour day", () => {
    expect(isOpenNow(allDay24(), gmt("2026-11-16T03:00:00"))).toEqual({ state: "open" });
    expect(isOpenNow(allDay24(), gmt("2026-11-16T00:00:00"))).toEqual({ state: "open" });
    expect(isOpenNow(allDay24(), gmt("2026-11-16T23:59:00"))).toEqual({ state: "open" });
  });

  it("closes at midnight after a 24-hour day when the next day starts later", () => {
    const value = days(["00:00", "00:00"], ["09:00", "17:00"], [], [], [], [], []);
    expect(isOpenNow(value, gmt("2026-11-16T23:00:00"))).toEqual({
      state: "open",
      closesAt: "midnight",
    });
    // Tuesday 00:00: Monday's 24 hours have ended.
    expect(isOpenNow(value, gmt("2026-11-17T00:00:00"))).toEqual({
      state: "closed",
      opensAt: "9am",
    });
  });

  it("handles overnight ranges across midnight", () => {
    // Monday 22:00 to Tuesday 06:00, Tuesday otherwise closed.
    const value = days(["22:00", "06:00"], [], [], [], [], [], []);
    expect(isOpenNow(value, gmt("2026-11-16T21:59:00"))).toEqual({
      state: "closed",
      opensAt: "10pm",
    });
    expect(isOpenNow(value, gmt("2026-11-16T22:00:00"))).toEqual({
      state: "open",
      closesAt: "6am",
    });
    expect(isOpenNow(value, gmt("2026-11-16T23:59:00")).state).toBe("open");
    // Tuesday just after midnight: still open from Monday.
    expect(isOpenNow(value, gmt("2026-11-17T00:00:00"))).toEqual({
      state: "open",
      closesAt: "6am",
    });
    expect(isOpenNow(value, gmt("2026-11-17T05:59:00")).state).toBe("open");
    expect(isOpenNow(value, gmt("2026-11-17T06:00:00"))).toEqual({
      state: "closed",
      opensAt: "10pm Monday",
    });
  });

  it("handles an overnight range from Sunday into Monday", () => {
    const value = days([], [], [], [], [], [], ["20:00", "02:00"]);
    // Monday 01:00 (GMT): open from Sunday night.
    expect(isOpenNow(value, gmt("2026-11-16T01:00:00"))).toEqual({
      state: "open",
      closesAt: "2am",
    });
    expect(isOpenNow(value, gmt("2026-11-16T02:00:00"))).toEqual({
      state: "closed",
      opensAt: "8pm Sunday",
    });
  });

  it("treats a range ending at midnight as ending that day", () => {
    const value = days(["18:00", "24:00"], ["18:00", "00:00"], [], [], [], [], []);
    expect(isOpenNow(value, gmt("2026-11-16T23:59:00"))).toEqual({
      state: "open",
      closesAt: "midnight",
    });
    expect(isOpenNow(value, gmt("2026-11-17T00:00:00"))).toEqual({
      state: "closed",
      opensAt: "6pm",
    });
    expect(isOpenNow(value, gmt("2026-11-17T23:00:00"))).toEqual({
      state: "open",
      closesAt: "midnight",
    });
    expect(isOpenNow(value, gmt("2026-11-18T00:30:00"))).toEqual({
      state: "closed",
      opensAt: "6pm Monday",
    });
  });

  it("treats 00:00–24:00 as open around the clock", () => {
    expect(isOpenNow(week(["00:00", "24:00"]), gmt("2026-11-16T12:00:00"))).toEqual({
      state: "open",
    });
    const value = days(["00:00", "24:00"], [], [], [], [], [], []);
    expect(isOpenNow(value, gmt("2026-11-16T23:00:00"))).toEqual({
      state: "open",
      closesAt: "midnight",
    });
  });

  it("uses the later close when yesterday's overnight range overlaps today's hours", () => {
    // Monday 18:00–02:00, then Tuesday open 24 hours: at Tuesday 01:00 it is open all day.
    const into24 = days(["18:00", "02:00"], ["00:00", "00:00"], [], [], [], [], []);
    expect(isOpenNow(into24, gmt("2026-11-17T01:00:00"))).toEqual({
      state: "open",
      closesAt: "midnight",
    });
    // Tuesday opening at 00:00 and closing at 23:00.
    const intoDay = days(["18:00", "02:00"], ["00:00", "23:00"], [], [], [], [], []);
    expect(isOpenNow(intoDay, gmt("2026-11-17T01:00:00"))).toEqual({
      state: "open",
      closesAt: "11pm",
    });
    // Tuesday's own short range closes before Monday's spill-over does.
    const shortToday = days(["18:00", "02:00"], ["00:30", "01:30"], [], [], [], [], []);
    expect(isOpenNow(shortToday, gmt("2026-11-17T01:00:00"))).toEqual({
      state: "open",
      closesAt: "2am",
    });
    // Every day 18:00–02:00 and a 24-hour Wednesday that continues into Thursday 24 hours.
    const chain = days(["18:00", "02:00"], ["00:00", "00:00"], ["00:00", "00:00"], [], [], [], []);
    expect(isOpenNow(chain, gmt("2026-11-17T01:00:00"))).toEqual({ state: "open" });
  });

  it("an overnight range spills over even across the BST change", () => {
    // Saturday 28 March 22:00 GMT to Sunday 06:00 BST.
    const value = days([], [], [], [], [], ["22:00", "06:00"], []);
    expect(isOpenNow(value, new Date("2026-03-29T04:30:00Z"))).toEqual({
      state: "open",
      closesAt: "6am",
    });
    expect(isOpenNow(value, new Date("2026-03-29T05:00:00Z")).state).toBe("closed");
  });

  it("names the next opening day, or none if always closed", () => {
    const weekendOnly = weekdaysAndWeekends([], ["10:00", "16:00"]);
    expect(isOpenNow(weekendOnly, gmt("2026-11-16T12:00:00"))).toEqual({
      state: "closed",
      opensAt: "10am Saturday",
    });
    expect(isOpenNow(weekendOnly, gmt("2026-11-20T12:00:00"))).toEqual({
      state: "closed",
      opensAt: "10am tomorrow",
    });
    const next24 = days([], ["00:00", "00:00"], [], [], [], [], []);
    expect(isOpenNow(next24, gmt("2026-11-16T12:00:00"))).toEqual({
      state: "closed",
      opensAt: "midnight tomorrow",
    });
    expect(isOpenNow(week([]), gmt("2026-11-16T12:00:00"))).toEqual({ state: "closed" });
  });

  it("ignores half-entered days", () => {
    const value = week(["09:00", "17:00"]);
    value[0] = ["09:00", ""];
    expect(isOpenNow(value, gmt("2026-11-16T12:00:00"))).toEqual({
      state: "closed",
      opensAt: "9am tomorrow",
    });
  });
});
