import { useId, useRef, useState } from "preact/hooks";
import "./OpeningHoursInput.css";
import {
  allDay24,
  createDefaultOpeningTimes,
  DAYS,
  type DayHours,
  DEFAULT_DAY_HOURS,
  is24h,
  isOpen24Every,
  isOvernight,
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
} from "./openingTimes";

export type { DayHours, OpeningTimes };

export interface OpeningHoursInputProps {
  /** `null` means the opening hours are not known. */
  value: OpeningTimes | null;
  onChange: (value: OpeningTimes | null) => void;
  /** Accessible name for the first question (visually hidden). */
  label?: string;
  /**
   * Shown under the editor. When the hours themselves are invalid, the
   * message is rewritten to name the row the user can see (e.g. "Monday to
   * Friday" rather than "Monday"); any other message is shown as given.
   */
  error?: string;
  /**
   * Put on the first question's group (focusable with `tabIndex=-1`), so an
   * error summary can link to `#id` and move focus to the opening hours.
   * While there is an error, the first invalid time input also carries
   * `data-first-invalid-for="<id>"`, so the form can focus it directly:
   * `document.querySelector('[data-first-invalid-for="hours"]')`.
   */
  id?: string;
}

type Mode = "unknown" | "24h" | "set";
export type OpeningHoursLayout = "same" | "weekdays" | "custom";

interface Row {
  key: string;
  /** Full name, used for the legend and control labels ("Monday to Friday"). */
  name: string;
  /** Short visible label ("Mon–Fri"). */
  short: string;
  indexes: readonly number[];
}

const WEEKDAYS = [0, 1, 2, 3, 4] as const;
const WEEKEND = [5, 6] as const;

const ROWS: Record<OpeningHoursLayout, Row[]> = {
  same: [{ key: "all", name: "Every day", short: "Every day", indexes: [0, 1, 2, 3, 4, 5, 6] }],
  weekdays: [
    { key: "weekdays", name: "Monday to Friday", short: "Mon–Fri", indexes: WEEKDAYS },
    { key: "weekend", name: "Saturday and Sunday", short: "Sat–Sun", indexes: WEEKEND },
  ],
  custom: DAYS.map((day, index) => ({ key: day, name: day, short: day, indexes: [index] })),
};

/** Simplest first. */
const LAYOUT_ORDER: readonly OpeningHoursLayout[] = ["same", "weekdays", "custom"];

const LAYOUT_OPTIONS: { value: OpeningHoursLayout; label: string }[] = [
  { value: "same", label: "Same every day" },
  { value: "weekdays", label: "Weekdays + weekends" },
  { value: "custom", label: "Different each day" },
];

const allSame = (hours: OpeningTimes, indexes: readonly number[]) =>
  indexes.every((index) => sameDay(hours[index], hours[indexes[0]]));

/** Whether the rows of `layout` can show `hours` without hiding a difference. */
export function layoutFits(layout: OpeningHoursLayout, hours: OpeningTimes): boolean {
  if (layout === "same") return allSame(hours, ROWS.same[0].indexes);
  if (layout === "weekdays") return allSame(hours, WEEKDAYS) && allSame(hours, WEEKEND);
  return true;
}

/** The simplest layout that shows `hours` without hiding a difference. */
export const simplestLayout = (hours: OpeningTimes): OpeningHoursLayout =>
  LAYOUT_ORDER.find((layout) => layoutFits(layout, hours)) ?? "custom";

/**
 * How a message names each day in `layout`: its row's name, so "Monday to
 * Friday" (or "every day") rather than "Monday" when days are grouped.
 */
const dayLabelsFor = (layout: OpeningHoursLayout): string[] =>
  DAYS.map((_, index) => {
    const row = ROWS[layout].find((r) => r.indexes.includes(index));
    return row?.key === "all" ? "every day" : (row?.name ?? "");
  });

const copyWeek = (hours: OpeningTimes): OpeningTimes => hours.map((day) => [...day] as DayHours);

const sameWeek = (a: OpeningTimes, b: OpeningTimes) => JSON.stringify(a) === JSON.stringify(b);

/** The first open day among `indexes`, else the first of them. */
const representative = (hours: OpeningTimes, indexes: readonly number[]): DayHours =>
  hours[indexes.find((index) => hours[index].length === 2) ?? indexes[0]] ?? [];

/** "24:00" is valid data but a time input can't show it; it is the same midnight as "00:00". */
const displayTime = (time: string) => (time === "24:00" ? "00:00" : time);

type DayStatus = "closed" | "open" | "24h";

/**
 * `keepOpen` is set while the user is typing in a row whose times happen to
 * match (e.g. 09:00 to 17:00 passing through 17:00 to 17:00): such a pair
 * means 24 hours, but the row stays "Open" with its inputs until focus leaves it.
 */
const statusOf = (day: DayHours, keepOpen = false): DayStatus =>
  day.length !== 2 ? "closed" : is24h(day) && !keepOpen ? "24h" : "open";

const STATUS_OPTIONS: { value: DayStatus; label: string }[] = [
  { value: "closed", label: "Closed" },
  { value: "open", label: "Open" },
  { value: "24h", label: "24 hours" },
];

/**
 * Opening hours editor in three steps: whether the hours are known, how they
 * vary through the week, then one row per day (or per group of days).
 *
 * `value` is fully controlled. Local state is presentational (which layout of
 * rows to show, falling back to a finer one whenever the value would not fit
 * the chosen layout) plus memory that makes switches undoable: the last
 * custom hours come back after "Don't know" or "Open 24/7", hours collapsed
 * by a simpler layout come back when switching back before editing, and a
 * row set to Closed or 24 hours gets its last times back when set to Open.
 */
export default function OpeningHoursInput({
  value,
  onChange,
  label = "Opening hours",
  error,
  id,
}: OpeningHoursInputProps) {
  const baseId = useId();
  const hours = value === null ? null : normaliseOpeningTimes(value);

  // Existing hours open on the simplest layout that shows every difference.
  const [layout, setLayout] = useState<OpeningHoursLayout>(() =>
    value === null || isOpen24Every(value) ? "same" : simplestLayout(normaliseOpeningTimes(value)),
  );
  // Remembers that "Set the hours" was chosen (or a row edited), so making
  // every day 24 hours doesn't snap the rows away into "Open 24/7".
  const [preferSet, setPreferSet] = useState(false);
  // Rows kept "Open" while their times match mid-edit (see `statusOf`).
  const [keepOpen, setKeepOpen] = useState<ReadonlySet<string>>(() => new Set());

  // The last hours that were neither unknown nor 24/7, restored by "Set the hours".
  const lastCustom = useRef<OpeningTimes | null>(null);
  if (hours && !isOpen24Every(hours)) lastCustom.current = hours;
  // The hours before a simpler layout merged them, while nothing has been edited since.
  const collapsed = useRef<{ before: OpeningTimes; after: OpeningTimes } | null>(null);
  // Each row's last open range, restored when it goes from Closed or 24 hours back to Open.
  const lastRange = useRef<Record<string, [string, string]>>({});

  const mode: Mode =
    hours === null ? "unknown" : isOpen24Every(hours) && !preferSet ? "24h" : "set";
  const effectiveLayout: OpeningHoursLayout = hours
    ? (LAYOUT_ORDER.slice(LAYOUT_ORDER.indexOf(layout)).find((l) => layoutFits(l, hours)) ??
      "custom")
    : layout;

  const errorId = `${baseId}-error`;
  const summaryId = `${baseId}-summary`;

  const setRowKeepOpen = (key: string, on: boolean) =>
    setKeepOpen((current) => {
      if (current.has(key) === on) return current;
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const chooseMode = (next: Mode) => {
    if (next === mode) return;
    setKeepOpen(new Set());
    collapsed.current = null;
    if (next === "unknown") {
      setPreferSet(false);
      onChange(null);
    } else if (next === "24h") {
      setPreferSet(false);
      onChange(allDay24());
    } else {
      const restored = lastCustom.current
        ? copyWeek(lastCustom.current)
        : createDefaultOpeningTimes();
      setPreferSet(true);
      setLayout(simplestLayout(restored));
      onChange(restored);
    }
  };

  const chooseLayout = (next: OpeningHoursLayout) => {
    if (!hours) return;
    setLayout(next);
    setKeepOpen(new Set());
    const stash =
      collapsed.current && sameWeek(hours, collapsed.current.after) ? collapsed.current : null;
    // Switching back before any edit undoes the merge.
    if (stash && layoutFits(next, stash.before)) {
      collapsed.current = null;
      onChange(copyWeek(stash.before));
      return;
    }
    collapsed.current = stash;
    if (layoutFits(next, hours)) return;
    const merged =
      next === "same"
        ? sameEveryDay(representative(hours, ROWS.same[0].indexes))
        : weekdaysAndWeekends(representative(hours, WEEKDAYS), representative(hours, WEEKEND));
    collapsed.current = { before: stash?.before ?? hours, after: merged };
    onChange(merged);
  };

  const setRow = (row: Row, next: DayHours) => {
    if (!hours) return;
    setPreferSet(true);
    onChange(
      hours.map((day, index) => (row.indexes.includes(index) ? ([...next] as DayHours) : day)),
    );
  };

  const setStatus = (row: Row, current: DayHours, status: DayStatus) => {
    const keep = keepOpen.has(row.key);
    if (status === statusOf(current, keep)) return;
    if (keep) setRowKeepOpen(row.key, false);
    if (status === "closed") setRow(row, []);
    else if (status === "24h") setRow(row, TWENTY_FOUR_HOURS);
    else setRow(row, lastRange.current[row.key] ?? DEFAULT_DAY_HOURS);
  };

  const setTime = (row: Row, current: DayHours, position: 0 | 1, time: string) => {
    if (current.length !== 2) return;
    const next: [string, string] = [current[0], current[1]];
    next[position] = time;
    setRowKeepOpen(row.key, is24h(next));
    setRow(row, next);
  };

  // Rows that lost focus with matching times become what the data says: 24 hours.
  const leaveRow = (row: Row, event: FocusEvent) => {
    const to = event.relatedTarget as Node | null;
    if (to && (event.currentTarget as Node).contains(to)) return;
    setRowKeepOpen(row.key, false);
  };

  // When the hours are invalid, name the row the user can see.
  const shownError =
    error && hours
      ? (validateOpeningTimes(hours, { dayLabels: dayLabelsFor(effectiveLayout) }) ?? error)
      : error;
  let firstInvalidMarked = false;

  return (
    <div class="oh-input">
      <p class="oh-summary" id={summaryId} role="status">
        {summariseOpeningTimes(hours)}
      </p>

      <fieldset
        class="oh-fieldset oh-step"
        id={id}
        tabIndex={id ? -1 : undefined}
        aria-describedby={shownError ? errorId : undefined}
      >
        <legend class="oh-sr">{label}</legend>
        <div class="oh-segmented oh-mode">
          {(
            [
              ["unknown", "Don't know"],
              ["24h", "Open 24/7"],
              ["set", "Set the hours"],
            ] as const
          ).map(([option, text]) => (
            <label class="oh-toggle-option" key={option}>
              <input
                type="radio"
                class="oh-radio"
                name={`${baseId}-mode`}
                value={option}
                checked={mode === option}
                onChange={() => chooseMode(option)}
              />
              <span class={`oh-toggle-label${mode === option ? " oh-toggle-label--active" : ""}`}>
                {text}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "unknown" && (
        <p class="oh-hint">
          We'll show the hours as not known. Choose "Set the hours" if you know them.
        </p>
      )}

      {mode === "set" && hours && (
        <>
          <fieldset class="oh-fieldset oh-step">
            <legend class="oh-question">How do the hours vary?</legend>
            <div class="oh-segmented oh-presets">
              {LAYOUT_OPTIONS.map((option) => (
                <label class="oh-toggle-option" key={option.value}>
                  <input
                    type="radio"
                    class="oh-radio"
                    name={`${baseId}-layout`}
                    value={option.value}
                    checked={effectiveLayout === option.value}
                    onChange={() => chooseLayout(option.value)}
                  />
                  <span
                    class={`oh-toggle-label${
                      effectiveLayout === option.value ? " oh-toggle-label--active" : ""
                    }`}
                  >
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div class="oh-grid">
            {ROWS[effectiveLayout].map((row) => {
              const day = hours[row.indexes[0]];
              const status = statusOf(day, keepOpen.has(row.key));
              const rowId = `${baseId}-row-${row.key}`;
              const invalid = !!error && validateDay(day) !== null;
              const overnight = status === "open" && isOvernight(day);
              const sameTimes = status === "open" && is24h(day);
              const noteId = `${rowId}-note`;
              if (status === "open" && day.length === 2 && !is24h(day)) {
                if (isValidTime(day[0]) && isValidTime(day[1])) {
                  lastRange.current[row.key] = [day[0], day[1]];
                }
              }
              const invalidOpen = invalid && !isValidTime(day[0]);
              const invalidClose = invalid && !isValidTime(day[1]);
              const firstInvalid = invalidOpen ? 0 : invalidClose ? 1 : null;
              const markFirst = firstInvalid !== null && !firstInvalidMarked;
              if (markFirst) firstInvalidMarked = true;
              const invalidProps = (position: 0 | 1) => ({
                "aria-invalid": (position === 0 ? invalidOpen : invalidClose)
                  ? ("true" as const)
                  : undefined,
                "data-first-invalid-for":
                  markFirst && firstInvalid === position && id ? id : undefined,
              });
              const describedBy = (position: 0 | 1) =>
                [
                  (position === 0 ? invalidOpen : invalidClose) && shownError ? errorId : "",
                  position === 1 && (overnight || sameTimes) ? noteId : "",
                  position === 0 && sameTimes ? noteId : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined;

              return (
                <fieldset
                  class={`oh-fieldset oh-day-group${status === "closed" ? " oh-day-group--closed" : ""}`}
                  key={row.key}
                  data-day={row.name}
                  onFocusOut={(event) => leaveRow(row, event)}
                >
                  <legend class="oh-sr">{row.name}</legend>
                  <div class="oh-row">
                    <span class="oh-day" aria-hidden="true">
                      {row.short}
                    </span>

                    <div class="oh-segmented oh-status">
                      {STATUS_OPTIONS.map((option) => (
                        <label class="oh-toggle-option" key={option.value}>
                          <input
                            type="radio"
                            class="oh-radio"
                            name={`${rowId}-status`}
                            value={option.value}
                            checked={status === option.value}
                            onChange={() => setStatus(row, day, option.value)}
                          />
                          <span
                            class={`oh-toggle-label${
                              status === option.value ? " oh-toggle-label--active" : ""
                            }`}
                          >
                            {option.label}
                          </span>
                        </label>
                      ))}
                    </div>

                    {status === "open" && day.length === 2 && (
                      <div class="oh-times">
                        <label class="oh-sr" for={`${rowId}-open`}>
                          {row.name} opening time
                        </label>
                        <input
                          id={`${rowId}-open`}
                          type="time"
                          class="oh-time-field"
                          value={displayTime(day[0])}
                          {...invalidProps(0)}
                          aria-describedby={describedBy(0)}
                          onInput={(e) =>
                            setTime(row, day, 0, (e.target as HTMLInputElement).value)
                          }
                        />
                        <span class="oh-time-sep" aria-hidden="true">
                          to
                        </span>
                        <label class="oh-sr" for={`${rowId}-close`}>
                          {row.name} closing time
                        </label>
                        <input
                          id={`${rowId}-close`}
                          type="time"
                          class="oh-time-field"
                          value={displayTime(day[1])}
                          {...invalidProps(1)}
                          aria-describedby={describedBy(1)}
                          onInput={(e) =>
                            setTime(row, day, 1, (e.target as HTMLInputElement).value)
                          }
                        />
                      </div>
                    )}

                    {(overnight || sameTimes) && (
                      <p class="oh-row-note" id={noteId}>
                        {sameTimes
                          ? "The opening and closing times are the same, so this counts as open 24 hours."
                          : "Closes the next morning"}
                      </p>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </>
      )}

      {shownError && (
        <p class="oh-error" id={errorId} role="alert">
          {shownError}
        </p>
      )}
    </div>
  );
}
