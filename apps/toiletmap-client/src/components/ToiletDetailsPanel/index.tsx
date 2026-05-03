import { useState } from "preact/hooks";
import type { IconName } from "toiletmap-design-system";
import { Button, Icon, Stack } from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import styles from "./ToiletDetailsPanel.module.css";

const FEATURES: Array<{ key: keyof LooDetail; label: string; icon: IconName }> = [
  { key: "accessible", label: "Accessible", icon: "wheelchair-move" },
  { key: "allGender", label: "All Gender", icon: "person-dress" },
  { key: "men", label: "Men", icon: "person" },
  { key: "women", label: "Women", icon: "person-dress" },
  { key: "children", label: "Children", icon: "child" },
  { key: "babyChange", label: "Baby Change", icon: "baby" },
  { key: "radar", label: "Radar Key", icon: "key" },
  { key: "automatic", label: "Automatic", icon: "gear" },
];

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
    return (
      <Icon icon="check" size="small" style={{ color: "var(--color-success)" }} aria-label="Yes" />
    );
  }
  if (value === false) {
    return (
      <Icon
        icon="xmark"
        size="small"
        style={{ color: "var(--color-accent-pink)" }}
        aria-label="No"
      />
    );
  }
  return (
    <Icon
      icon="question"
      size="small"
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
  const [isExpanded, setIsExpanded] = useState(true);
  const today = todayIndex();

  const directionsUrl = toilet.location
    ? `https://maps.apple.com/?dirflg=w&daddr=${toilet.location.lat},${toilet.location.lng}`
    : null;

  if (!isExpanded) {
    return (
      <div className={styles.collapsed}>
        <div className={styles.collapsedHeader}>
          <h2 className={styles.name}>{toilet.name ?? "Toilet"}</h2>
          <Button htmlElement="button" variant="secondary" onClick={onClose}>
            <Icon icon="xmark" size="small" />
            Close
          </Button>
        </div>
        <div className={styles.collapsedActions}>
          {directionsUrl && (
            <Button
              htmlElement="a"
              variant="primary"
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon icon="diamond-turn-right" size="small" />
              Directions
            </Button>
          )}
          <Button htmlElement="button" variant="secondary" onClick={() => setIsExpanded(true)}>
            <Icon icon="list" size="small" />
            Details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.expanded}>
      <div className={styles.expandedHeader}>
        <Button htmlElement="button" variant="secondary" onClick={onClose}>
          <Icon icon="xmark" size="small" />
          Close
        </Button>
      </div>

      <div className={styles.expandedContent}>
        <div className={styles.grid}>
          {/* Column 1: Details */}
          <Stack space="s">
            <h2 className={styles.name}>{toilet.name ?? "Toilet"}</h2>
            {directionsUrl && (
              <div className={styles.directionsWrapper}>
                <Button
                  htmlElement="a"
                  variant="primary"
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon icon="diamond-turn-right" size="small" />
                  Directions
                </Button>
              </div>
            )}
            <div>
              <p className={styles.verifyPrompt}>Is this information correct?</p>
              <div className={styles.verifyActions}>
                <Button htmlElement="button" variant="primary">
                  Yes
                </Button>
                <span className={styles.verifyNoSpan}>
                  No?{" "}
                  <Button htmlElement="a" variant="secondary" href={`/loo/${toilet.id}/edit`}>
                    <Icon icon="pen-to-square" size="small" />
                    Edit
                  </Button>
                </span>
              </div>
            </div>
            <p className={styles.updatedAt}>Last updated: {formatUpdatedAt(toilet.updatedAt)}</p>
          </Stack>

          {/* Column 2: Features */}
          <div>
            <h3 className={styles.colHeading}>Features</h3>
            <ul className={styles.featureList}>
              {FEATURES.map(({ key, label, icon }) => (
                <li key={key} className={styles.featureItem}>
                  <span className={styles.featureLabel}>
                    <Icon icon={icon} size="small" />
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
              <Icon icon="clock" size="small" />
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
              <a href={`/loo/${toilet.id}/edit`}>Edit this toilet</a> if out of date.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
