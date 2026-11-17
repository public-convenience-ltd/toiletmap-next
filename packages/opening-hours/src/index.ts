/**
 * Framework-free helpers for Toilet Map opening hours.
 *
 * Data model (mirrors the API's `openingTimes` field):
 * - `null`: the opening hours are not known.
 * - A 7-element array, Monday first. Each day is either:
 *   - `[]`: closed all day, or
 *   - `[open, close]`: "HH:mm" strings between 00:00 and 24:00.
 *     - Any pair where open === close (e.g. ["00:00", "00:00"]) means open 24 hours,
 *       and so does ["00:00", "24:00"] (midnight to midnight).
 *     - Overnight ranges, where close is earlier than open (e.g. ["22:00", "06:00"]),
 *       are allowed: the toilet closes the next morning.
 *
 * Shared by the public client, the design system and the admin UI, so it must
 * stay free of any framework or DOM dependency.
 */

export type DayHours = [string, string] | [];
export type OpeningTimes = DayHours[];

/** Anything shaped like a day, including readonly tuples and loosely typed API data. */
export type DayLike = readonly string[];

/**
 * Anything shaped like a week. Accepts other packages' opening-times types
 * (e.g. the server's Zod-inferred `([string, string] | never[])[]`).
 */
export type OpeningTimesLike = readonly DayLike[];

export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type DayName = (typeof DAYS)[number];

export const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Indexes (Monday = 0) of the weekdays and the weekend. */
export const WEEKDAY_INDEXES = [0, 1, 2, 3, 4] as const;
export const WEEKEND_INDEXES = [5, 6] as const;

export const DEFAULT_DAY_HOURS: [string, string] = ["09:00", "17:00"];
export const TWENTY_FOUR_HOURS: [string, string] = ["00:00", "00:00"];

/** The time zone every toilet's hours are expressed in. */
export const TIME_ZONE = "Europe/London";

const TIME_PATTERN = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;
const MINUTES_PER_DAY = 24 * 60;

// ── Predicates ────────────────────────────────────────────────────────────────

/** True when the string is a valid "HH:mm" time between 00:00 and 24:00. */
export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

/**
 * True for a day open around the clock: any non-empty pair whose opening and
 * closing times are equal, or 00:00–24:00 (midnight to midnight).
 */
export function is24h(day: DayLike | null | undefined): boolean {
  if (!day || day.length !== 2 || day[0] === "") return false;
  return day[0] === day[1] || (day[0] === "00:00" && day[1] === "24:00");
}

/** Alias kept for existing callers (design system and admin UI). */
export const isTwentyFourHours = is24h;

/** True for a day marked closed (an empty array). */
export function isClosedDay(day: DayLike | null | undefined): boolean {
  return Array.isArray(day) && day.length === 0;
}

/** True for a valid open range that runs past midnight (close earlier than open). */
export function isOvernight(day: DayLike | null | undefined): boolean {
  if (!day || day.length !== 2 || !isValidTime(day[0]) || !isValidTime(day[1])) return false;
  if (is24h(day)) return false;
  const close = toMinutes(day[1]);
  // Closing at 00:00 or 24:00 is midnight at the end of the same day.
  return close !== 0 && close !== MINUTES_PER_DAY && close < toMinutes(day[0]);
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates a single day. Returns `null` when valid, otherwise a user-facing
 * message. Pass the day's name to have it included in the message.
 */
export function validateDay(day: unknown, dayName?: string): string | null {
  const forDay = dayName ? ` for ${dayName}` : "";
  if (!Array.isArray(day)) {
    return dayName
      ? `Enter opening hours for ${dayName}, or mark it as closed.`
      : "Enter opening hours, or mark the day as closed.";
  }
  if (day.length === 0) return null;
  if (day.length !== 2 || !day[0] || !day[1]) {
    return `Enter both opening and closing times${forDay}.`;
  }
  if (!isValidTime(day[0]) || !isValidTime(day[1])) {
    return `Enter times${forDay} as HH:MM, between 00:00 and 24:00.`;
  }
  return null;
}

export interface ValidateOpeningTimesOptions {
  /**
   * The name to use for each day (Monday first) in the message, in place of
   * the day names. An editor that groups days into one row passes the row's
   * label for each day in it, e.g. "Monday to Friday" five times, so the
   * message names the row the user can see.
   */
  dayLabels?: readonly string[];
}

/**
 * Validates a week of opening times. `null` (not known) is valid.
 * Returns `null` when valid, otherwise a user-facing message naming the day
 * (or its label from `options.dayLabels`).
 */
export function validateOpeningTimes(
  value: OpeningTimesLike | null,
  options: ValidateOpeningTimesOptions = {},
): string | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== DAYS.length) {
    return "Opening hours must include all seven days.";
  }
  for (let index = 0; index < DAYS.length; index++) {
    const message = validateDay(value[index], options.dayLabels?.[index] || DAYS[index]);
    if (message) return message;
  }
  return null;
}

// ── Constructors and presets ──────────────────────────────────────────────────

const copyDay = (day: DayLike | null | undefined): DayHours =>
  day && day.length === 2 ? [day[0], day[1]] : [];

/** The same hours every day (each day is an independent copy). */
export function sameEveryDay(range: DayLike): OpeningTimes {
  return DAYS.map(() => copyDay(range));
}

/** One range Monday to Friday and another on Saturday and Sunday. Pass `[]` for closed. */
export function weekdaysAndWeekends(weekdayRange: DayLike, weekendRange: DayLike): OpeningTimes {
  return DAYS.map((_, index) => copyDay(index < 5 ? weekdayRange : weekendRange));
}

/** Open 24 hours, every day. */
export function allDay24(): OpeningTimes {
  return sameEveryDay(TWENTY_FOUR_HOURS);
}

/** A starting point when the user chooses to set hours: 09:00–17:00 every day. */
export function createDefaultOpeningTimes(): OpeningTimes {
  return sameEveryDay(DEFAULT_DAY_HOURS);
}

/** Normalises any partial or malformed array into exactly seven day entries. */
export function normaliseOpeningTimes(value: readonly (DayLike | null | undefined)[]): OpeningTimes {
  return DAYS.map((_, index) => {
    const day = value[index];
    return Array.isArray(day) ? (day as DayHours) : [];
  });
}

/** Returns a copy of `value` with the source day copied to each target day. */
export function copyDayTo(
  value: OpeningTimes,
  sourceIndex: number,
  targetIndexes: readonly number[],
): OpeningTimes {
  const source = value[sourceIndex] ?? [];
  return value.map((day, index) => (targetIndexes.includes(index) ? copyDay(source) : day));
}

/** True when two days hold the same hours (all 24-hour pairs count as equal). */
export function sameDay(a: DayLike | null | undefined, b: DayLike | null | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (is24h(left) && is24h(right)) return true;
  return left.length === right.length && left.every((time, index) => time === right[index]);
}

/** True when every day is open 24 hours. */
export function isOpen24Every(value: OpeningTimesLike | null | undefined): boolean {
  return (
    Array.isArray(value) &&
    value.length === DAYS.length &&
    value.every((day) => is24h(day))
  );
}

// ── Formatting ────────────────────────────────────────────────────────────────

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Formats a "HH:mm" time in plain English: "9am", "1:30pm", "midday", "midnight".
 * Invalid input is returned unchanged ("?" when empty) so a half-typed time
 * never throws.
 */
export function formatTime(time: string): string {
  if (!isValidTime(time)) return time ? time : "?";
  const minutesOfDay = toMinutes(time) % MINUTES_PER_DAY;
  if (minutesOfDay === 0) return "midnight";
  if (minutesOfDay === 12 * 60) return "midday";
  const hours24 = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return minutes === 0
    ? `${hours12}${suffix}`
    : `${hours12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

/** "9am–5pm", "10pm–6am", "Open 24 hours" or "Closed". */
export function formatRange(day: DayLike | null | undefined): string {
  if (!day || day.length !== 2) return "Closed";
  if (is24h(day)) return "Open 24 hours";
  return `${formatTime(day[0])}–${formatTime(day[1])}`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * A short plain-English summary of a week, grouping consecutive days with the
 * same hours: "Mon–Fri 9am–5pm · Sat 10am–4pm · Sun closed".
 */
export function summariseOpeningTimes(value: OpeningTimesLike | null | undefined): string {
  if (value === null || value === undefined || !Array.isArray(value)) {
    return "Opening hours not known";
  }
  const week = normaliseOpeningTimes(value);
  if (week.every((day) => is24h(day))) return "Open 24 hours, every day";
  if (week.every((day) => day.length !== 2)) return "Closed every day";
  if (week.every((day) => sameDay(day, week[0]))) return `Every day ${formatRange(week[0])}`;

  const groups: { start: number; end: number; day: DayHours }[] = [];
  week.forEach((day, index) => {
    const last = groups[groups.length - 1];
    if (last && sameDay(last.day, day)) {
      last.end = index;
    } else {
      groups.push({ start: index, end: index, day });
    }
  });

  return groups
    .map(({ start, end, day }) => {
      const days = start === end ? SHORT_DAYS[start] : `${SHORT_DAYS[start]}–${SHORT_DAYS[end]}`;
      return `${days} ${lowerFirst(formatRange(day))}`;
    })
    .join(" · ");
}

// ── Open now ──────────────────────────────────────────────────────────────────

export type OpenNowState = "open" | "closed" | "unknown";

export interface OpenNow {
  state: OpenNowState;
  /** When open: the closing time, e.g. "5pm" or "midnight". Absent when open around the clock. */
  closesAt?: string;
  /**
   * When closed: the next opening, e.g. "9am" (later today), "9am tomorrow"
   * or "10am Saturday". Absent when there is no upcoming opening.
   */
  opensAt?: string;
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

let londonFormatter: Intl.DateTimeFormat | null = null;

/** The Europe/London weekday (Monday = 0) and minutes since local midnight. */
export function londonClock(date: Date): { dayIndex: number; minutes: number } {
  londonFormatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = londonFormatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hours = Number(get("hour")) % 24;
  return {
    dayIndex: WEEKDAY_TO_INDEX[get("weekday")] ?? 0,
    minutes: hours * 60 + Number(get("minute")),
  };
}

/** A day's open interval in minutes, with close > open (overnight closes after 1440). */
function interval(day: DayHours): { open: number; close: number } | null {
  if (day.length !== 2 || !isValidTime(day[0]) || !isValidTime(day[1])) return null;
  const open = toMinutes(day[0]);
  if (is24h(day)) return { open: 0, close: MINUTES_PER_DAY };
  let close = toMinutes(day[1]);
  if (close <= open) close += MINUTES_PER_DAY;
  return { open, close };
}

/**
 * Whether the toilet is open at `date`, using Europe/London local time.
 * Handles overnight ranges (open late into the next morning) and 24-hour days.
 */
export function isOpenNow(value: OpeningTimesLike | null | undefined, date: Date): OpenNow {
  if (!Array.isArray(value) || value.length !== DAYS.length) return { state: "unknown" };
  const week = normaliseOpeningTimes(value);
  const { dayIndex, minutes } = londonClock(date);
  const today = week[dayIndex];
  const todayInterval = interval(today);

  // Still open from yesterday's overnight range? Its close, in minutes since today's midnight.
  const yesterdayDay = week[(dayIndex + 6) % 7];
  const yesterday = interval(yesterdayDay);
  const fromYesterday =
    yesterday && !is24h(yesterdayDay) && minutes < yesterday.close - MINUTES_PER_DAY
      ? yesterday.close - MINUTES_PER_DAY
      : null;
  const inToday =
    todayInterval !== null && minutes >= todayInterval.open && minutes < todayInterval.close;

  // When both ranges cover now (e.g. Mon 18:00–02:00 then Tue open 24 hours or
  // from 00:00), the one that closes later decides the closing time.
  if (inToday && (fromYesterday === null || todayInterval.close >= fromYesterday)) {
    if (is24h(today)) {
      const tomorrow = week[(dayIndex + 1) % 7];
      const continues = is24h(tomorrow) || (tomorrow.length === 2 && tomorrow[0] === "00:00");
      return continues ? { state: "open" } : { state: "open", closesAt: "midnight" };
    }
    return { state: "open", closesAt: formatTime(today[1] as string) };
  }
  if (fromYesterday !== null) {
    return { state: "open", closesAt: formatTime(yesterdayDay[1] as string) };
  }

  // Closed: find the next opening, later today or on a following day.
  if (todayInterval && minutes < todayInterval.open) {
    return { state: "closed", opensAt: formatTime(today[0] as string) };
  }
  for (let offset = 1; offset <= 7; offset++) {
    const index = (dayIndex + offset) % 7;
    const day = week[index];
    if (!interval(day)) continue;
    const time = is24h(day) ? "midnight" : formatTime(day[0] as string);
    const when = offset === 1 ? "tomorrow" : DAYS[index];
    return { state: "closed", opensAt: `${time} ${when}` };
  }
  return { state: "closed" };
}
