/** @jsxImportSource hono/jsx/dom */

import { useId } from "hono/jsx";
import type { OpeningTimes } from "../../../../services/loo/types";
import {
  copyDayTo,
  createDefaultWeek,
  DAYS,
  type DayHours,
  DEFAULT_DAY_HOURS,
  isTwentyFourHours,
  normaliseWeek,
  TWENTY_FOUR_HOURS,
} from "./utils/opening-hours";

type Props = {
  /** `null` means the opening hours are not known. */
  value: OpeningTimes;
  onChange: (value: OpeningTimes) => void;
  error?: string;
};

const WEEKDAY_INDEXES = [1, 2, 3, 4];
const OTHER_DAY_INDEXES = [1, 2, 3, 4, 5, 6];

/**
 * Fully controlled opening hours editor: everything is derived from `value`,
 * so `null` ("not known") is preserved until the moderator chooses to set hours.
 */
export const OpeningHoursInput = ({ value, onChange, error }: Props) => {
  const baseId = useId();
  const isKnown = value !== null && value !== undefined;
  const hours = isKnown ? normaliseWeek(value) : null;

  const setDay = (dayIndex: number, next: DayHours) => {
    if (!hours) return;
    onChange(hours.map((day, index) => (index === dayIndex ? next : day)));
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
      <fieldset class="oh-fieldset" aria-invalid={error ? "true" : "false"}>
        <legend class="oh-visually-hidden">Are the opening hours known?</legend>
        <div class="tri-state-container">
          <label class="tri-state-option">
            <input
              type="radio"
              name={`${baseId}-mode`}
              value="unknown"
              checked={!isKnown}
              onChange={() => {
                if (isKnown) onChange(null);
              }}
            />
            <span class="tri-state-label">Don't know</span>
          </label>
          <label class="tri-state-option">
            <input
              type="radio"
              name={`${baseId}-mode`}
              value="known"
              checked={isKnown}
              onChange={() => {
                if (!isKnown) onChange(createDefaultWeek());
              }}
            />
            <span class="tri-state-label">Set opening hours</span>
          </label>
        </div>
      </fieldset>

      {!isKnown && (
        <p class="field-hint">
          Opening hours will be saved as "not known". Choose "Set opening hours" to enter them.
        </p>
      )}

      {hours && (
        <>
          <p class="field-hint">
            Every day starts at 09:00–17:00. Check each day and change any that are different.
          </p>
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
              const isOpen = times.length === 2;
              const is24h = isOpen && isTwentyFourHours(times);
              const legendId = `${baseId}-day-${index}`;

              return (
                <fieldset class="oh-fieldset" key={day}>
                  <legend class="oh-visually-hidden" id={legendId}>
                    {day}
                  </legend>
                  <div class="opening-hours-row">
                    <span class="day-name" aria-hidden="true">
                      {day}
                    </span>

                    <div class="tri-state-container oh-status">
                      <label class="tri-state-option">
                        <input
                          type="radio"
                          name={`${baseId}-status-${index}`}
                          value="closed"
                          checked={!isOpen}
                          onChange={() => setDay(index, [])}
                        />
                        <span class="tri-state-label">Closed</span>
                      </label>
                      <label class="tri-state-option">
                        <input
                          type="radio"
                          name={`${baseId}-status-${index}`}
                          value="open"
                          checked={isOpen}
                          onChange={() => {
                            if (!isOpen) setDay(index, [...DEFAULT_DAY_HOURS]);
                          }}
                        />
                        <span class="tri-state-label">Open</span>
                      </label>
                    </div>

                    {isOpen && (
                      <div class="time-inputs">
                        {is24h ? (
                          <span class="oh-24h-text">Open 24 hours</span>
                        ) : (
                          <>
                            <input
                              type="time"
                              value={times[0]}
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
                              value={times[1]}
                              onInput={(e: Event) =>
                                setTime(index, 1, (e.target as HTMLInputElement).value)
                              }
                              class="input time-input"
                              aria-label={`${day} closing time`}
                            />
                          </>
                        )}
                      </div>
                    )}

                    {isOpen && (
                      <label class="checkbox-label">
                        <input
                          type="checkbox"
                          checked={is24h}
                          aria-label={`${day}: open 24 hours`}
                          onChange={(e: Event) =>
                            setDay(
                              index,
                              (e.target as HTMLInputElement).checked
                                ? [...TWENTY_FOUR_HOURS]
                                : [...DEFAULT_DAY_HOURS],
                            )
                          }
                        />
                        <span aria-hidden="true">24 hours</span>
                      </label>
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
                    grid-template-columns: 7rem 11rem minmax(0, 1fr) max-content;
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
                .checkbox-label {
                    grid-column: 4;
                    display: flex;
                    align-items: center;
                    gap: var(--space-2xs);
                    cursor: pointer;
                    font-size: var(--text--1);
                    font-weight: 500;
                    color: var(--color-primary-navy);
                    white-space: nowrap;
                }
                .oh-24h-text {
                    font-weight: 600;
                    color: var(--color-primary-navy);
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
                    .time-inputs, .checkbox-label { grid-column: 1 / -1; }
                    .time-input { flex: 1; width: auto; }
                }
            `}</style>
    </div>
  );
};
