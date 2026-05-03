import { useState } from "preact/hooks";
import Icon from "../Icon/Icon";
import "./OpeningHoursInput.css";

export type DayHours = [string, string] | [];
export type OpeningTimes = DayHours[];

export interface OpeningHoursInputProps {
  value: OpeningTimes | null;
  onChange: (value: OpeningTimes) => void;
  error?: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DEFAULT_HOURS: DayHours = ["09:00", "17:00"];

export default function OpeningHoursInput({ value, onChange, error }: OpeningHoursInputProps) {
  const [hours, setHours] = useState<string[][]>(value ?? Array(7).fill([]));

  const updateDay = (dayIndex: number, newTimes: string[]) => {
    const next = [...hours];
    next[dayIndex] = newTimes;
    setHours(next);
    onChange(next as OpeningTimes);
  };

  const handleOpenToggle = (dayIndex: number, isOpen: boolean) => {
    updateDay(dayIndex, isOpen ? [...DEFAULT_HOURS] : []);
  };

  const handleTimeChange = (dayIndex: number, type: "open" | "close", time: string) => {
    const day = hours[dayIndex];
    if (day.length !== 2) return;
    const next = [...day];
    next[type === "open" ? 0 : 1] = time;
    updateDay(dayIndex, next);
  };

  const handle24hToggle = (dayIndex: number, is24h: boolean) => {
    updateDay(dayIndex, is24h ? ["00:00", "00:00"] : [...DEFAULT_HOURS]);
  };

  const copyToNext = (dayIndex: number) => {
    if (dayIndex >= 6) return;
    updateDay(dayIndex + 1, [...hours[dayIndex]]);
  };

  const applyToAll = (dayIndex: number) => {
    const times = hours[dayIndex];
    const next = hours.map(() => [...times]);
    setHours(next);
    onChange(next as OpeningTimes);
  };

  return (
    <div class="oh-input">
      <div class="oh-grid">
        {DAYS.map((day, index) => {
          const times = hours[index] ?? [];
          const isOpen = times.length > 0;
          const is24h = isOpen && times[0] === "00:00" && times[1] === "00:00";

          return (
            <div class="oh-row" key={day}>
              <span class="oh-day">{day}</span>

              {/* Open / Closed toggle */}
              <div class="oh-status">
                <label class="oh-toggle-option">
                  <input
                    type="radio"
                    name={`oh-status-${index}`}
                    checked={isOpen}
                    onChange={() => handleOpenToggle(index, true)}
                    class="oh-radio"
                  />
                  <span class={`oh-toggle-label${isOpen ? " oh-toggle-label--active" : ""}`}>
                    Open
                  </span>
                </label>
                <label class="oh-toggle-option">
                  <input
                    type="radio"
                    name={`oh-status-${index}`}
                    checked={!isOpen}
                    onChange={() => handleOpenToggle(index, false)}
                    class="oh-radio"
                  />
                  <span class={`oh-toggle-label${!isOpen ? " oh-toggle-label--active" : ""}`}>
                    Closed
                  </span>
                </label>
              </div>

              {/* Time inputs */}
              <div class="oh-times">
                {isOpen && (
                  <>
                    <label class="oh-checkbox-label">
                      <input
                        type="checkbox"
                        checked={is24h}
                        onChange={(e) =>
                          handle24hToggle(index, (e.target as HTMLInputElement).checked)
                        }
                        class="oh-checkbox"
                      />
                      <span>24 hrs</span>
                    </label>
                    {!is24h && (
                      <div class="oh-time-inputs">
                        <input
                          type="time"
                          value={times[0]}
                          onChange={(e) =>
                            handleTimeChange(index, "open", (e.target as HTMLInputElement).value)
                          }
                          class="oh-time-field"
                          aria-label={`${day} opening time`}
                        />
                        <span class="oh-time-sep">–</span>
                        <input
                          type="time"
                          value={times[1]}
                          onChange={(e) =>
                            handleTimeChange(index, "close", (e.target as HTMLInputElement).value)
                          }
                          class="oh-time-field"
                          aria-label={`${day} closing time`}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Bulk actions */}
              <div class="oh-actions">
                {index < 6 && (
                  <button
                    type="button"
                    class="oh-action-btn"
                    onClick={() => copyToNext(index)}
                    title="Copy to next day"
                    aria-label={`Copy ${day} hours to next day`}
                  >
                    <Icon icon="chevron-down" size="small" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  class="oh-action-btn"
                  onClick={() => applyToAll(index)}
                  title="Apply to all days"
                  aria-label={`Apply ${day} hours to all days`}
                >
                  <Icon icon="asterisk" size="small" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p class="oh-error">{error}</p>}
    </div>
  );
}
