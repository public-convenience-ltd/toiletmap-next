/**
 * Opening-times helpers for the design system. The logic lives in the shared
 * `@toiletmap/opening-hours` package (also used by the client and the admin
 * UI); this module re-exports it under the names the design system has
 * always exposed.
 */
export {
  allDay24,
  copyDayTo,
  createDefaultOpeningTimes,
  DAYS,
  type DayHours,
  DEFAULT_DAY_HOURS,
  formatRange,
  formatTime,
  is24h,
  isClosedDay,
  isOpen24Every,
  isOpenNow,
  isOvernight,
  isTwentyFourHours,
  isValidTime,
  normaliseOpeningTimes,
  type OpeningTimes,
  sameDay,
  sameEveryDay,
  summariseOpeningTimes,
  TWENTY_FOUR_HOURS,
  validateDay,
  validateOpeningTimes,
  weekdaysAndWeekends,
} from "@toiletmap/opening-hours";
