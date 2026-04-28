import { useState } from "preact/hooks";
import type { LooDetail } from "../../api/loos";
import styles from "./ToiletDetailsPanel.module.css";

const FEATURES = [
  { key: "accessible", label: "Accessible", faIcon: "fa-wheelchair" },
  { key: "allGender", label: "All Gender", faIcon: "fa-person-dress" },
  { key: "men", label: "Men", faIcon: "fa-person" },
  { key: "women", label: "Women", faIcon: "fa-person-dress" },
  { key: "children", label: "Children", faIcon: "fa-child" },
  { key: "babyChange", label: "Baby Change", faIcon: "fa-baby" },
  { key: "radar", label: "Radar Key", faIcon: "fa-key" },
  { key: "automatic", label: "Automatic", faIcon: "fa-gear" },
] as const;

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function todayIndex(): number {
  // getDay() returns 0=Sunday; remap to 0=Monday … 6=Sunday to match openingTimes array
  return (new Date().getDay() + 6) % 7;
}

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hr24 = Number.parseInt(h, 10);
  const hr = hr24 === 24 ? 0 : hr24;
  const period = hr24 >= 12 && hr24 < 24 ? "pm" : "am";
  const display = hr % 12 === 0 ? 12 : hr % 12;
  return `${display}:${m} ${period}`;
}

function formatDayHours(day: [string, string] | [] | undefined): string {
  if (day === undefined) return "Unknown";
  if (day.length === 0) return "Closed";
  return `${formatTime(day[0])} – ${formatTime(day[1])}`;
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function FeatureStatus({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return <i role="img" className={`fa-solid fa-check ${styles.featureCheck}`} aria-label="Yes" />;
  }
  if (value === false) {
    return (
      <i
        role="img"
        className="fa-solid fa-xmark"
        style={{ color: "var(--color-accent-pink)" }}
        aria-label="No"
      />
    );
  }
  return (
    <i
      role="img"
      className="fa-solid fa-question"
      style={{ color: "var(--color-neutral-grey)" }}
      aria-label="Unknown"
    />
  );
}

interface ToiletDetailsPanelProps {
  toilet: LooDetail;
  onClose: () => void;
}

export default function ToiletDetailsPanel({ toilet, onClose }: ToiletDetailsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const today = todayIndex();

  const directionsUrl = toilet.location
    ? `https://maps.apple.com/?dirflg=w&daddr=${toilet.location.lat},${toilet.location.lng}`
    : null;

  if (!isExpanded) {
    return (
      <div className={`${styles.panel} ${styles.collapsed}`}>
        <div className={styles.collapsedHeader}>
          <h2 className={styles.name}>{toilet.name ?? "Toilet"}</h2>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onClose}
            aria-label="Close"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
            Close
          </button>
        </div>
        <div className={styles.collapsedActions}>
          {directionsUrl && (
            <a
              href={directionsUrl}
              className={styles.btnPrimary}
              target="_blank"
              rel="noopener noreferrer"
            >
              <i className="fa-solid fa-diamond-turn-right" aria-hidden="true" />
              Directions
            </a>
          )}
          <button type="button" className={styles.btnSecondary} onClick={() => setIsExpanded(true)}>
            <i className="fa-solid fa-list" aria-hidden="true" />
            Details
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.panel} ${styles.expanded}`}>
      <div className={styles.expandedHeader}>
        <button type="button" className={styles.btnSecondary} onClick={onClose} aria-label="Close">
          <i className="fa-solid fa-xmark" aria-hidden="true" />
          Close
        </button>
      </div>

      <div className={styles.expandedContent}>
        <div className={styles.grid}>
          {/* Column 1: Details */}
          <div className={styles.detailsCol}>
            <h2 className={styles.name}>{toilet.name ?? "Toilet"}</h2>
            {directionsUrl && (
              <a
                href={directionsUrl}
                className={styles.btnPrimary}
                target="_blank"
                rel="noopener noreferrer"
              >
                <i className="fa-solid fa-diamond-turn-right" aria-hidden="true" />
                Directions
              </a>
            )}
            <div>
              <p className={styles.verifyPrompt}>Is this information correct?</p>
              <div className={styles.verifyActions}>
                <button type="button" className={styles.btnPrimary}>
                  Yes
                </button>
                <span className={styles.verifyNoSpan}>
                  No?{" "}
                  <a href={`/loos/${toilet.id}/edit`} className={styles.btnSecondary}>
                    <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                    Edit
                  </a>
                </span>
              </div>
            </div>
            <p className={styles.updatedAt}>Last updated: {formatUpdatedAt(toilet.updatedAt)}</p>
          </div>

          {/* Column 2: Features */}
          <div>
            <h3 className={styles.colHeading}>Features</h3>
            <ul className={styles.featureList}>
              {FEATURES.map(({ key, label, faIcon }) => (
                <li key={key} className={styles.featureItem}>
                  <span className={styles.featureLabel}>
                    <i className={`fa-solid ${faIcon}`} aria-hidden="true" />
                    {label}
                  </span>
                  <FeatureStatus value={toilet[key] as boolean | null | undefined} />
                </li>
              ))}
            </ul>
            {toilet.noPayment === false && (
              <div className={styles.feeSection}>
                <h4 className={styles.feeHeading}>Fee</h4>
                <p className={styles.feeDetail}>{toilet.paymentDetails ?? "Unknown"}</p>
              </div>
            )}
          </div>

          {/* Column 3: Opening Hours */}
          <div>
            <h3 className={styles.colHeading}>
              <i className="fa-solid fa-clock" aria-hidden="true" />
              Opening Hours
            </h3>
            <ul className={styles.hoursList}>
              {DAYS.map((day, i) => {
                const dayEntry = toilet.openingTimes?.[i] as [string, string] | [] | undefined;
                return (
                  <li
                    key={day}
                    className={`${styles.hoursRow}${i === today ? ` ${styles.today}` : ""}`}
                  >
                    <span className={styles.dayName}>{day}</span>
                    <span className={styles.dayHours}>{formatDayHours(dayEntry)}</span>
                  </li>
                );
              })}
            </ul>
            <p className={styles.hoursNote}>
              Hours may vary with national holidays or seasonal changes.{" "}
              <a href={`/loos/${toilet.id}/edit`}>Edit this toilet</a> if out of date.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
