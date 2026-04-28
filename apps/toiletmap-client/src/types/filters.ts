export const FILTER_BIT = {
  NO_PAYMENT: 0b00000001,
  ALL_GENDER: 0b00000010,
  AUTOMATIC: 0b00000100,
  ACCESSIBLE: 0b00001000,
  BABY_CHNG: 0b00010000,
  RADAR: 0b00100000,
} as const;

export type FilterKey = keyof typeof FILTER_BIT;

export type ActiveFilters = Record<FilterKey, boolean>;

export const DEFAULT_FILTERS: ActiveFilters = {
  NO_PAYMENT: false,
  ALL_GENDER: false,
  AUTOMATIC: false,
  ACCESSIBLE: false,
  BABY_CHNG: false,
  RADAR: false,
};
