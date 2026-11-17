/**
 * Pure helpers for opening-times data.
 *
 * Data model (mirrors the API):
 * - `null` — opening hours are not known.
 * - A 7-element array, Monday first. Each day is either:
 *   - `[]` — closed all day, or
 *   - `[open, close]` — "HH:mm" strings (00:00–24:00). Overnight ranges
 *     (close earlier than open) are allowed. Any pair where open === close
 *     (e.g. ["00:00", "00:00"]) means open 24 hours.
 */

export type DayHours = [string, string] | [];
export type OpeningTimes = DayHours[];

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

const TIME_PATTERN = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

/** True for any non-empty pair whose opening and closing times are equal. */
export function isTwentyFourHours(day: [string, string] | [] | readonly string[]): boolean {
  return day.length === 2 && day[0] !== "" && day[0] === day[1];
}

/** True when the string is a valid "HH:mm" time between 00:00 and 24:00. */
export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

/** A starting point when the user chooses to set hours: 09:00–17:00 every day. */
export function createDefaultOpeningTimes(): OpeningTimes {
  return DAYS.map(() => [...DEFAULT_DAY_HOURS] as [string, string]);
}

/**
 * Validates opening times.
 * Returns `null` when valid, otherwise a user-facing message.
 */
export function validateOpeningTimes(value: OpeningTimes | null): string | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== DAYS.length) {
    return "Opening hours must include all seven days.";
  }

  for (let index = 0; index < DAYS.length; index++) {
    const day = value[index] as unknown;
    const dayName = DAYS[index];
    if (!Array.isArray(day)) {
      return `Enter opening hours for ${dayName}, or mark it as closed.`;
    }
    if (day.length === 0) continue;
    if (day.length !== 2 || !day[0] || !day[1]) {
      return `Enter both opening and closing times for ${dayName}.`;
    }
    if (!isValidTime(day[0]) || !isValidTime(day[1])) {
      return `Enter times for ${dayName} as HH:MM, between 00:00 and 24:00.`;
    }
  }

  return null;
}

/** Returns the same value with every day copied from `sourceIndex` to the target days. */
export function copyDayTo(
  value: OpeningTimes,
  sourceIndex: number,
  targetIndexes: readonly number[],
): OpeningTimes {
  const source = value[sourceIndex] ?? [];
  return value.map((day, index) =>
    targetIndexes.includes(index) ? ([...source] as DayHours) : day,
  );
}

/** Normalises any partial or malformed array into exactly seven day entries. */
export function normaliseOpeningTimes(value: OpeningTimes): OpeningTimes {
  return DAYS.map((_, index) => {
    const day = value[index];
    return Array.isArray(day) ? day : [];
  });
}
