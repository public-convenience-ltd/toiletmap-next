import type { OpeningTimes } from "../../services/loo/types";

/** Any non-empty pair whose opening and closing times are equal means "open 24 hours". */
const isTwentyFourHours = (day: readonly string[]): boolean =>
  day.length === 2 && day[0] !== "" && day[0] === day[1];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const OpeningHours = (props: { openingTimes: OpeningTimes }) => {
  if (!props.openingTimes) {
    return <span style="color: var(--color-neutral-grey);">Unknown</span>;
  }

  // Check if all days are closed (empty arrays)
  const isClosed = props.openingTimes.every((day) => day.length === 0);
  if (isClosed) {
    return <span style="color: var(--color-accent-pink);">Closed</span>;
  }

  return (
    <ul style="list-style: none; padding: 0; margin: 0; font-size: var(--text-0);">
      {props.openingTimes.map((times, index) => {
        const dayName = DAYS[index];
        let timeString = "Closed";

        if (times.length === 2) {
          const [open, close] = times;
          // Any pair where open === close (e.g. 00:00–00:00) means open 24 hours.
          timeString = isTwentyFourHours(times) ? "24 Hours" : `${open} - ${close}`;
        }

        const isToday = new Date().getDay() === (index + 1) % 7;

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
            <span>{timeString}</span>
          </li>
        );
      })}
    </ul>
  );
};
