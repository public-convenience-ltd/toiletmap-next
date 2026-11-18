/**
 * Scalar behaviour of the legacy GraphQL API, reproduced exactly:
 * `DateTime` follows graphql-iso-date 0.x (`GraphQLDateTime`) and
 * `OpeningTimes` follows the legacy custom scalar.
 *
 * Invalid values throw plain `TypeError`/`Error` (not `GraphQLError`) on
 * purpose: the legacy server masked such errors to "Unexpected error.", and
 * the handler's error masking keys on exactly that distinction.
 */
import { Kind, type ValueNode } from "graphql";

// ---------------------------------------------------------------------------
// DateTime (graphql-iso-date)
// ---------------------------------------------------------------------------

const RFC_3339_DATE_TIME =
  /^(\d{4}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]|60))(\.\d{1,})?(([Z])|([+|-]([01][0-9]|2[0-3]):[0-5][0-9]))$/;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** RFC 3339 `date-time` check, as graphql-iso-date's `validateDateTime`. */
export const isValidDateTimeString = (value: string): boolean => {
  if (!RFC_3339_DATE_TIME.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= maxDay;
};

/**
 * graphql-iso-date's `serializeDateTimeString`: a value already in UTC (`Z`)
 * is returned unchanged; an offset is shifted to UTC while keeping the
 * original fraction digits (none, 2, 6, ...), so `...08.63+00:00` becomes
 * `...08.63Z` rather than `...08.630Z`.
 */
export const serializeDateTimeString = (value: string): string => {
  if (value.includes("Z")) return value;
  const utc = new Date(value).toISOString();
  const fraction = /\.\d*/.exec(value);
  return fraction ? utc.replace(/\.\d*/, fraction[0]) : utc.replace(/\.\d*/, "");
};

export const serializeDateTime = (value: unknown): string => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("DateTime cannot represent an invalid Date instance");
    }
    return value.toISOString();
  }
  if (typeof value === "string") {
    if (isValidDateTimeString(value)) return serializeDateTimeString(value);
    throw new TypeError(`DateTime cannot represent an invalid date-time-string ${value}.`);
  }
  throw new TypeError(
    `DateTime cannot be serialized from a non string, non numeric or non Date type ${JSON.stringify(value)}`,
  );
};

export const parseDateTimeValue = (value: unknown): Date => {
  if (typeof value !== "string") {
    throw new TypeError(`DateTime cannot represent non string type ${JSON.stringify(value)}`);
  }
  if (!isValidDateTimeString(value)) {
    throw new TypeError(`DateTime cannot represent an invalid date-time-string ${value}.`);
  }
  return new Date(value);
};

export const parseDateTimeLiteral = (ast: ValueNode): Date => {
  if (ast.kind !== Kind.STRING) {
    throw new TypeError(
      `DateTime cannot represent non string type ${"value" in ast ? String(ast.value) : ast.kind}`,
    );
  }
  return parseDateTimeValue(ast.value);
};

// ---------------------------------------------------------------------------
// OpeningTimes (legacy custom scalar)
// ---------------------------------------------------------------------------

const LEGACY_TIME = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

/** Throws unless `value` is 7 days, each `[]` or `["HH:MM", "HH:MM"]`. */
export const validateOpeningTimes = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || value.length !== 7) {
    throw new Error("Type OpeningTimes must be an array of length 7");
  }
  const valid = value.every(
    (day) =>
      Array.isArray(day) &&
      (day.length === 0 ||
        (day.length === 2 &&
          day.every((time) => typeof time === "string" && LEGACY_TIME.test(time)))),
  );
  if (!valid) {
    throw new Error('Type OpeningTimes must be an array of [] or ["XX:XX", "XX:XX"] elements');
  }
  return value;
};

const literalToValue = (ast: ValueNode): unknown => {
  if (ast.kind === Kind.LIST) return ast.values.map(literalToValue);
  return "value" in ast ? ast.value : null;
};

export const parseOpeningTimesLiteral = (ast: ValueNode): unknown[] => {
  if (ast.kind !== Kind.LIST) {
    throw new Error("Type OpeningTimes must be an array");
  }
  return validateOpeningTimes(literalToValue(ast));
};
