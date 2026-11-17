/** @jsxImportSource hono/jsx/dom */

import { useId, useState } from "hono/jsx";
import type { OpeningTimes } from "../../../../services/loo/types";
import {
  copyDayTo,
  createAllDayWeek,
  createDefaultWeek,
  DAYS,
  type DayHours,
  DEFAULT_DAY_HOURS,
  isOpen24Every,
  isOvernight,
  isTwentyFourHours,
  normaliseWeek,
  summariseOpeningTimes,
  TWENTY_FOUR_HOURS,
} from "./utils/opening-hours";

type Props = {
  /** `null` means the opening hours are not known. */
  value: OpeningTimes;
  onChange: (value: OpeningTimes) => void;
  error?: string;
};

type Mode = "unknown" | "24h" | "set";
type DayStatus = "closed" | "open" | "24h";

const WEEKDAY_INDEXES = [1, 2, 3, 4];
const OTHER_DAY_INDEXES = [1, 2, 3, 4, 5, 6];

const MODES: [Mode, string][] = [
  ["unknown", "Don't know"],
  ["24h", "Open 24/7"],
  ["set", "Set the hours"],
];

const STATUSES: [DayStatus, string][] = [
  ["closed", "Closed"],
  ["open", "Open"],
  ["24h", "24 hours"],
];

const statusOf = (day: DayHours): DayStatus =>
  day.length !== 2 ? "closed" : isTwentyFourHours(day) ? "24h" : "open";

/** "24:00" is valid data but a time input can't show it; it is the same midnight as "00:00". */
const displayTime = (time: string) => (time === "24:00" ? "00:00" : time);

/**
 * Fully controlled opening hours editor: everything is derived from `value`,
 * so `null` ("not known") is preserved until the moderator chooses to set hours.
 * Mirrors the public design-system editor: Don't know / Open 24/7 / Set the
 * hours, a live summary, and Closed / Open / 24 hours per day.
 */
export const OpeningHoursInput = ({ value, onChange, error }: Props) => {
  const baseId = useId();
  const isKnown = value !== null && value !== undefined;
  const hours = isKnown ? normaliseWeek(value) : null;
  // Remembers "Set the hours" so making each day 24 hours doesn't hide the rows.
  const [preferSet, setPreferSet] = useState(false);
  const mode: Mode = !hours ? "unknown" : isOpen24Every(hours) && !preferSet ? "24h" : "set";

  const chooseMode = (next: Mode) => {
    if (next === mode) return;
    setPreferSet(next === "set");
    if (next === "unknown") onChange(null);
    else if (next === "24h") onChange(createAllDayWeek());
    else onChange(createDefaultWeek());
  };

  const setDay = (dayIndex: number, next: DayHours) => {
    if (!hours) return;
    onChange(hours.map((day, index) => (index === dayIndex ? next : day)));
  };

  const setStatus = (dayIndex: number, status: DayStatus) => {
    if (!hours || statusOf(hours[dayIndex]) === status) return;
    if (status === "closed") setDay(dayIndex, []);
    else if (status === "24h") setDay(dayIndex, [...TWENTY_FOUR_HOURS]);
    else setDay(dayIndex, [...DEFAULT_DAY_HOURS]);
  };

  const setTime = (dayIndex: number, position: 0 | 1, time: string) => {
    if (!hours) return;
    const day = hours[dayIndex];
    if (day.length !== 2) return;
    const next: [string, string] = [day[0], day[1]];
    next[position] = time;
    setDay(dayIndex, next);
  };

  return (
    <div class="opening-hours-input">
      <p class="oh-summary" role="status">
        {summariseOpeningTimes(hours)}
      </p>
      <fieldset class="oh-fieldset" aria-invalid={error ? "true" : "false"}>
        <legend class="oh-visually-hidden">Are the opening hours known?</legend>
        <div class="tri-state-container">
          {MODES.map(([option, text]) => (
            <label class="tri-state-option" key={option}>
              <input
                type="radio"
                name={`${baseId}-mode`}
                value={option}
                checked={mode === option}
                onChange={() => chooseMode(option)}
              />
              <span class="tri-state-label">{text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "unknown" && (
        <p class="field-hint">
          Opening hours will be saved as "not known". Choose "Set the hours" to enter them.
        </p>
      )}

      {mode === "set" && hours && (
        <>
          <div class="oh-bulk">
            <button
              type="button"
              class="button button--secondary"
              onClick={() => onChange(copyDayTo(hours, 0, OTHER_DAY_INDEXES))}
            >
              Copy Monday's hours to all days
            </button>
            <button
              type="button"
              class="button button--secondary"
              onClick={() => onChange(copyDayTo(hours, 0, WEEKDAY_INDEXES))}
            >
              Copy Monday to weekdays (Mon–Fri)
            </button>
          </div>

          <div class="opening-hours-grid">
            {DAYS.map((day, index) => {
              const times = hours[index];
              const status = statusOf(times);
              const overnight = status === "open" && isOvernight(times);
              const rowId = `${baseId}-day-${index}`;

              return (
                <fieldset class="oh-fieldset" key={day}>
                  <legend class="oh-visually-hidden">{day}</legend>
                  <div class="opening-hours-row">
                    <span class="day-name" aria-hidden="true">
                      {day}
                    </span>

                    <div class="tri-state-container oh-status">
                      {STATUSES.map(([option, text]) => (
                        <label class="tri-state-option" key={option}>
                          <input
                            type="radio"
                            name={`${rowId}-status`}
                            value={option}
                            checked={status === option}
                            onChange={() => setStatus(index, option)}
                          />
                          <span class="tri-state-label">{text}</span>
                        </label>
                      ))}
                    </div>

                    {status === "open" && times.length === 2 && (
                      <div class="time-inputs">
                        <input
                          type="time"
                          value={displayTime(times[0])}
                          onInput={(e: Event) =>
                            setTime(index, 0, (e.target as HTMLInputElement).value)
                          }
                          class="input time-input"
                          aria-label={`${day} opening time`}
                        />
                        <span class="time-separator" aria-hidden="true">
                          to
                        </span>
                        <input
                          type="time"
                          value={displayTime(times[1])}
                          onInput={(e: Event) =>
                            setTime(index, 1, (e.target as HTMLInputElement).value)
                          }
                          class="input time-input"
                          aria-label={`${day} closing time`}
                          aria-describedby={overnight ? `${rowId}-note` : undefined}
                        />
                        {overnight && (
                          <span class="oh-note" id={`${rowId}-note`}>
                            Closes the next morning
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </>
      )}
      {error && <p class="form-error">{error}</p>}

      <style>{`
                .opening-hours-input {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-xs);
                }
                .oh-fieldset {
                    border: 0;
                    margin: 0;
                    padding: 0;
                    min-width: 0;
                }
                .oh-visually-hidden {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    padding: 0;
                    margin: -1px;
                    overflow: hidden;
                    clip: rect(0, 0, 0, 0);
                    white-space: nowrap;
                    border: 0;
                }
                .oh-bulk {
                    display: flex;
                    flex-wrap: wrap;
                    gap: var(--space-2xs);
                }
                .opening-hours-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    background: var(--color-light-grey);
                    border: 1px solid var(--color-light-grey);
                    border-radius: 12px;
                    overflow: hidden;
                }
                /* day | status | times | 24 hours — fixed columns so rows align */
                .opening-hours-row {
                    display: grid;
                    grid-template-columns: 7rem max-content minmax(0, 1fr);
                    column-gap: var(--space-m);
                    row-gap: var(--space-2xs);
                    min-height: 3.5rem;
                    padding: var(--space-2xs) var(--space-m);
                    background: var(--color-white);
                    align-items: center;
                }
                .day-name {
                    grid-column: 1;
                    font-weight: 600;
                    font-size: var(--text-0);
                    color: var(--color-primary-navy);
                }
                .oh-status { grid-column: 2; justify-self: start; }
                .time-inputs {
                    grid-column: 3;
                    display: flex;
                    align-items: center;
                    gap: var(--space-xs);
                    min-width: 0;
                }
                .oh-summary {
                    margin: 0;
                    font-weight: 600;
                    color: var(--color-primary-navy);
                }
                .oh-note {
                    font-size: var(--text--1);
                    color: var(--color-neutral-grey);
                }
                .time-input {
                    padding: var(--space-2xs) var(--space-xs);
                    width: 8.5rem;
                    min-width: 0;
                    font-size: max(1rem, 16px);
                }
                .time-separator {
                    color: var(--color-neutral-grey);
                    font-size: var(--text--1);
                    font-weight: 500;
                }

                @media (max-width: 600px) {
                    .opening-hours-row {
                        grid-template-columns: minmax(0, 1fr) auto;
                        padding: var(--space-xs) var(--space-s);
                    }
                    .day-name, .oh-status { grid-column: auto; }
                    .time-inputs { grid-column: 1 / -1; flex-wrap: wrap; }
                    .time-input { flex: 1; width: auto; }
                }
            `}</style>
    </div>
  );
};
