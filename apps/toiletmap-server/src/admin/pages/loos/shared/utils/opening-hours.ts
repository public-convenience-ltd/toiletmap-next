/**
 * Opening-hours helpers for the admin editor. The pure logic lives in the
 * shared `@toiletmap/opening-hours` package (also used by the public client
 * and the design system); this module adapts it to the admin's types.
 */
import {
  allDay24,
  copyDayTo as copySharedDayTo,
  createDefaultOpeningTimes,
  DAYS,
  DEFAULT_DAY_HOURS,
  is24h,
  isOpen24Every,
  isOvernight,
  normaliseOpeningTimes,
  summariseOpeningTimes,
  TWENTY_FOUR_HOURS,
  validateOpeningTimes,
} from "@toiletmap/opening-hours";
import type { OpeningTimes } from "../../../../../services/loo/types";

/** A week of opening times (never null). */
export type OpeningWeek = NonNullable<OpeningTimes>;
export type DayHours = OpeningWeek[number];

export {
  DAYS,
  DEFAULT_DAY_HOURS,
  isOpen24Every,
  isOvernight,
  summariseOpeningTimes,
  TWENTY_FOUR_HOURS,
  validateOpeningTimes,
};

/** Any non-empty pair whose opening and closing times are equal means "open 24 hours". */
export const isTwentyFourHours = (day: readonly string[]): boolean => is24h(day);

// The shared package types closed days as `[]`; the server's Zod type uses
// `never[]`. They are the same at runtime, so these casts only bridge the types.
const asWeek = (value: readonly (readonly string[])[]): OpeningWeek => value as OpeningWeek;

/** Starting point when a moderator chooses to set hours: 09:00–17:00 every day. */
export const createDefaultWeek = (): OpeningWeek => asWeek(createDefaultOpeningTimes());

/** Open 24 hours every day. */
export const createAllDayWeek = (): OpeningWeek => asWeek(allDay24());

/** Always returns exactly seven day entries. */
export const normaliseWeek = (value: OpeningWeek): OpeningWeek =>
  asWeek(normaliseOpeningTimes(value));

export const copyDayTo = (
  value: OpeningWeek,
  sourceIndex: number,
  targetIndexes: readonly number[],
): OpeningWeek => asWeek(copySharedDayTo(normaliseOpeningTimes(value), sourceIndex, targetIndexes));
