import type { OpeningTimes } from "../../../../../services/loo/types";

/** A week of opening times (never null). */
export type OpeningWeek = NonNullable<OpeningTimes>;
export type DayHours = OpeningWeek[number];

export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const DEFAULT_DAY_HOURS: [string, string] = ["09:00", "17:00"];
export const TWENTY_FOUR_HOURS: [string, string] = ["00:00", "00:00"];

/** Any non-empty pair whose opening and closing times are equal means "open 24 hours". */
export const isTwentyFourHours = (day: readonly string[]): boolean =>
  day.length === 2 && day[0] !== "" && day[0] === day[1];

/** Starting point when a moderator chooses to set hours: 09:00–17:00 every day. */
export const createDefaultWeek = (): OpeningWeek =>
  DAYS.map(() => [...DEFAULT_DAY_HOURS] as [string, string]);

/** Always returns exactly seven day entries. */
export const normaliseWeek = (value: OpeningWeek): OpeningWeek =>
  DAYS.map((_, index) => {
    const day = value[index];
    return Array.isArray(day) ? day : [];
  });

export const copyDayTo = (
  value: OpeningWeek,
  sourceIndex: number,
  targetIndexes: readonly number[],
): OpeningWeek => {
  const source = value[sourceIndex] ?? [];
  return value.map((day, index) =>
    targetIndexes.includes(index) ? ([...source] as DayHours) : day,
  );
};
