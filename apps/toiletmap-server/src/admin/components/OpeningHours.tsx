import { DAYS, formatRange, londonClock, summariseOpeningTimes } from "@toiletmap/opening-hours";
import type { OpeningTimes } from "../../services/loo/types";

/**
 * Read-only opening hours for the admin detail page: a plain-English summary
 * plus one line per day, with today (in Europe/London) highlighted.
 */
export const OpeningHours = (props: { openingTimes: OpeningTimes; now?: Date }) => {
  if (!props.openingTimes) {
    return <span style="color: var(--color-neutral-grey);">Unknown</span>;
  }

  // Check if all days are closed (empty arrays)
  const isClosed = props.openingTimes.every((day) => day.length === 0);
  if (isClosed) {
    return <span style="color: var(--color-accent-pink);">Closed</span>;
  }

  const today = londonClock(props.now ?? new Date()).dayIndex;

  return (
    <div>
      <p
        style="margin: 0 0 var(--space-2xs); font-weight: 600;"
        data-testid="opening-hours-summary"
      >
        {summariseOpeningTimes(props.openingTimes)}
      </p>
      <ul style="list-style: none; padding: 0; margin: 0; font-size: var(--text-0);">
        {props.openingTimes.map((times, index) => {
          const dayName = DAYS[index];
          const isToday = index === today;

          return (
            <li
              key={dayName}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "var(--space-3xs) 0",
                borderBottom: "1px solid var(--color-neutral-light-grey)",
                fontWeight: isToday ? "600" : "normal",
                color: isToday ? "var(--color-primary)" : "inherit",
              }}
            >
              <span>{dayName}</span>
              <span>{formatRange(times)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
