/** @jsxImportSource hono/jsx/dom */

import { useState } from "hono/jsx";
import type { OpeningTimes } from "../../../../services/loo/types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Props = {
  value: OpeningTimes;
  onChange: (value: OpeningTimes) => void;
  error?: string;
};

export const OpeningHoursInput = ({ value, onChange, error }: Props) => {
  // Initialize state from props or default to closed (empty arrays)
  // value is OpeningTimes which is array of 7 arrays.
  // If null, we default to all closed.
  const [hours, setHours] = useState<string[][]>(value || Array(7).fill([]));

  const updateDay = (dayIndex: number, newTimes: string[]) => {
    const newHours = [...hours];
    newHours[dayIndex] = newTimes;
    setHours(newHours);
    onChange(newHours as OpeningTimes);
  };

  const handleOpenToggle = (dayIndex: number, isOpen: boolean) => {
    if (isOpen) {
      // Default to 09:00 - 17:00 when opening
      updateDay(dayIndex, ["09:00", "17:00"]);
    } else {
      updateDay(dayIndex, []);
    }
  };

  const handleTimeChange = (dayIndex: number, type: "open" | "close", time: string) => {
    const currentDay = hours[dayIndex];
    if (currentDay.length !== 2) return;

    const newTimes = [...currentDay];
    if (type === "open") newTimes[0] = time;
    else newTimes[1] = time;

    updateDay(dayIndex, newTimes);
  };

  const handle24hToggle = (dayIndex: number, is24h: boolean) => {
    if (is24h) {
      updateDay(dayIndex, ["00:00", "00:00"]);
    } else {
      // Revert to default hours
      updateDay(dayIndex, ["09:00", "17:00"]);
    }
  };

  const copyToNext = (dayIndex: number) => {
    if (dayIndex >= 6) return;
    const currentTimes = hours[dayIndex];
    updateDay(dayIndex + 1, [...currentTimes]);
  };

  const applyToAll = (dayIndex: number) => {
    const currentTimes = hours[dayIndex];
    const newHours = hours.map(() => [...currentTimes]);
    setHours(newHours);
    onChange(newHours as OpeningTimes);
  };

  return (
    <div class="opening-hours-input">
      <div class="opening-hours-grid">
        {DAYS.map((day, index) => {
          const times = hours[index] || [];
          const isOpen = times.length > 0;
          const is24h = isOpen && times[0] === "00:00" && times[1] === "00:00";

          return (
            <div class="opening-hours-row" key={day}>
              <div class="day-label">
                <span class="day-name">{day}</span>
              </div>

              <div class="status-toggle">
                <div class="tri-state-container">
                  <label class="tri-state-option">
                    <input
                      type="radio"
                      name={`status-${index}`}
                      checked={isOpen}
                      onChange={() => handleOpenToggle(index, true)}
                    />
                    <span class="tri-state-label">Open</span>
                  </label>
                  <label class="tri-state-option">
                    <input
                      type="radio"
                      name={`status-${index}`}
                      checked={!isOpen}
                      onChange={() => handleOpenToggle(index, false)}
                    />
                    <span class="tri-state-label">Closed</span>
                  </label>
                </div>
              </div>

              <div class="time-controls-wrapper">
                {isOpen && (
                  <div class="time-controls">
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        checked={is24h}
                        onChange={(e) =>
                          handle24hToggle(index, (e.target as HTMLInputElement).checked)
                        }
                      />
                      <span>24 Hours</span>
                    </label>

                    {!is24h && (
                      <div class="time-inputs">
                        <input
                          type="time"
                          value={times[0]}
                          onChange={(e) =>
                            handleTimeChange(index, "open", (e.target as HTMLInputElement).value)
                          }
                          class="input time-input"
                          aria-label={`${day} opening time`}
                        />
                        <span class="time-separator">to</span>
                        <input
                          type="time"
                          value={times[1]}
                          onChange={(e) =>
                            handleTimeChange(index, "close", (e.target as HTMLInputElement).value)
                          }
                          class="input time-input"
                          aria-label={`${day} closing time`}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div class="row-actions">
                {index < 6 && (
                  <button
                    type="button"
                    class="icon-button"
                    onClick={() => copyToNext(index)}
                    title="Copy these hours to the next day"
                    aria-label="Copy to next day"
                  >
                    <i class="fas fa-arrow-down" />
                  </button>
                )}
                <button
                  type="button"
                  class="icon-button"
                  onClick={() => applyToAll(index)}
                  title="Apply these hours to all days"
                  aria-label="Apply to all days"
                >
                  <i class="fas fa-copy" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p class="form-error">{error}</p>}

      <style>{`
                .opening-hours-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    background: var(--color-light-grey);
                    border: 1px solid var(--color-light-grey);
                    border-radius: 12px;
                    overflow: hidden;
                }
                .opening-hours-row {
                    display: grid;
                    grid-template-columns: 120px auto 1fr auto;
                    gap: var(--space-m);
                    padding: var(--space-s) var(--space-m);
                    background: var(--color-white);
                    align-items: center;
                }
                .day-name {
                    font-weight: 600;
                    font-size: var(--text-0);
                    color: var(--color-primary-navy);
                }
                .time-controls-wrapper {
                    min-height: 42px; /* Prevent layout shift when toggling */
                    display: flex;
                    align-items: center;
                }
                .time-controls {
                    display: flex;
                    align-items: center;
                    gap: var(--space-m);
                    flex-wrap: wrap;
                }
                .checkbox-label {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2xs);
                    cursor: pointer;
                    font-size: var(--text--1);
                    font-weight: 500;
                    color: var(--color-primary-navy);
                }
                .time-inputs {
                    display: flex;
                    align-items: center;
                    gap: var(--space-xs);
                }
                .time-input {
                    padding: var(--space-2xs) var(--space-xs);
                    width: auto;
                    min-width: 110px;
                }
                .time-separator {
                    color: var(--color-neutral-grey);
                    font-size: var(--text--1);
                    font-weight: 500;
                }
                .row-actions {
                    display: flex;
                    gap: var(--space-2xs);
                    justify-content: flex-end;
                    min-width: 80px;
                }
                .icon-button {
                    background: transparent;
                    border: none;
                    color: var(--color-neutral-grey);
                    cursor: pointer;
                    padding: var(--space-2xs);
                    border-radius: 50%;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                }
                .icon-button:hover {
                    background: var(--color-light-grey);
                    color: var(--color-primary-navy);
                }

                @media (max-width: 768px) {
                    .opening-hours-row {
                        grid-template-columns: 1fr auto;
                        grid-template-areas: 
                            "day status"
                            "time time"
                            "actions actions";
                        gap: var(--space-s);
                        padding: var(--space-m);
                    }
                    .day-label { grid-area: day; }
                    .status-toggle { grid-area: status; justify-self: end; }
                    .time-controls-wrapper { grid-area: time; }
                    .row-actions { grid-area: actions; justify-content: flex-start; }
                }
            `}</style>
    </div>
  );
};
