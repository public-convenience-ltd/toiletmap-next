import { useId } from "preact/hooks";
import "./OpeningHoursInput.css";
import {
  copyDayTo,
  createDefaultOpeningTimes,
  DAYS,
  type DayHours,
  DEFAULT_DAY_HOURS,
  isTwentyFourHours,
  normaliseOpeningTimes,
  type OpeningTimes,
  TWENTY_FOUR_HOURS,
} from "./openingTimes";

export type { DayHours, OpeningTimes };

export interface OpeningHoursInputProps {
  /** `null` means the opening hours are not known. */
  value: OpeningTimes | null;
  onChange: (value: OpeningTimes | null) => void;
  /** Accessible name for the "known / not known" choice. */
  label?: string;
  error?: string;
}

const WEEKDAY_INDEXES = [1, 2, 3, 4];
const OTHER_DAY_INDEXES = [1, 2, 3, 4, 5, 6];

/**
 * Fully controlled opening hours editor. All rendering derives from `value`;
 * the component never keeps its own copy of the hours.
 */
export default function OpeningHoursInput({
  value,
  onChange,
  label = "Opening hours",
  error,
}: OpeningHoursInputProps) {
  const baseId = useId();
  const isKnown = value !== null;
  const hours = isKnown ? normaliseOpeningTimes(value) : null;

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

  const errorId = `${baseId}-error`;

  return (
    <div class="oh-input">
      <div
        class="oh-mode"
        role="radiogroup"
        aria-label={label}
        aria-describedby={error ? errorId : undefined}
      >
        <label class="oh-toggle-option">
          <input
            type="radio"
            class="oh-radio"
            name={`${baseId}-mode`}
            value="unknown"
            checked={!isKnown}
            onChange={() => {
              if (isKnown) onChange(null);
            }}
          />
          <span class={`oh-toggle-label${!isKnown ? " oh-toggle-label--active" : ""}`}>
            Don't know
          </span>
        </label>
        <label class="oh-toggle-option">
          <input
            type="radio"
            class="oh-radio"
            name={`${baseId}-mode`}
            value="known"
            checked={isKnown}
            onChange={() => {
              if (!isKnown) onChange(createDefaultOpeningTimes());
            }}
          />
          <span class={`oh-toggle-label${isKnown ? " oh-toggle-label--active" : ""}`}>
            Set opening hours
          </span>
        </label>
      </div>

      {!isKnown && (
        <p class="oh-hint">
          The hours will be shown as "not known". Choose "Set opening hours" if you know them.
        </p>
      )}

      {hours && (
        <>
          <p class="oh-hint">
            Every day starts at 09:00–17:00. Check each day and change any that are different.
          </p>

          <div class="oh-bulk">
            <button
              type="button"
              class="oh-action-btn"
              onClick={() => onChange(copyDayTo(hours, 0, OTHER_DAY_INDEXES))}
            >
              Copy Monday's hours to all days
            </button>
            <button
              type="button"
              class="oh-action-btn"
              onClick={() => onChange(copyDayTo(hours, 0, WEEKDAY_INDEXES))}
            >
              Copy Monday to weekdays (Mon–Fri)
            </button>
          </div>

          <div class="oh-grid">
            {DAYS.map((day, index) => {
              const times = hours[index];
              const isOpen = times.length === 2;
              const is24h = isOpen && isTwentyFourHours(times);
              const dayId = `${baseId}-day-${index}`;

              return (
                <fieldset class="oh-day-group" key={day} data-day={day}>
                  <legend class="oh-legend" id={dayId}>
                    {day}
                  </legend>
                  <div class={`oh-row${isOpen ? "" : " oh-row--closed"}`}>
                    <span class="oh-day" aria-hidden="true">
                      {day}
                    </span>

                    <div class="oh-status" role="radiogroup" aria-labelledby={dayId}>
                      <label class="oh-toggle-option">
                        <input
                          type="radio"
                          class="oh-radio"
                          name={`${baseId}-status-${index}`}
                          value="closed"
                          checked={!isOpen}
                          onChange={() => setDay(index, [])}
                        />
                        <span class={`oh-toggle-label${!isOpen ? " oh-toggle-label--active" : ""}`}>
                          Closed
                        </span>
                      </label>
                      <label class="oh-toggle-option">
                        <input
                          type="radio"
                          class="oh-radio"
                          name={`${baseId}-status-${index}`}
                          value="open"
                          checked={isOpen}
                          onChange={() => {
                            if (!isOpen) setDay(index, [...DEFAULT_DAY_HOURS]);
                          }}
                        />
                        <span class={`oh-toggle-label${isOpen ? " oh-toggle-label--active" : ""}`}>
                          Open
                        </span>
                      </label>
                    </div>

                    {isOpen && (
                      <div class="oh-times">
                        {is24h ? (
                          <span class="oh-24h-text">Open 24 hours</span>
                        ) : (
                          <>
                            <input
                              type="time"
                              class="oh-time-field"
                              value={times[0]}
                              onInput={(e) =>
                                setTime(index, 0, (e.target as HTMLInputElement).value)
                              }
                              aria-label={`${day} opening time`}
                            />
                            <span class="oh-time-sep" aria-hidden="true">
                              to
                            </span>
                            <input
                              type="time"
                              class="oh-time-field"
                              value={times[1]}
                              onInput={(e) =>
                                setTime(index, 1, (e.target as HTMLInputElement).value)
                              }
                              aria-label={`${day} closing time`}
                            />
                          </>
                        )}
                      </div>
                    )}

                    {isOpen && (
                      <label class="oh-checkbox-label">
                        <input
                          type="checkbox"
                          class="oh-checkbox"
                          checked={is24h}
                          aria-label={`${day}: open 24 hours`}
                          onChange={(e) =>
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

      {error && (
        <p class="oh-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
