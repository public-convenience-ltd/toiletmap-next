import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { IconName } from "toiletmap-design-system";
import { Banner, Button, Icon, isTwentyFourHours, Stack } from "toiletmap-design-system";
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
  if (day === undefined) return "Not known";
  if (day.length === 0) return "Closed";
  // Any pair where open === close (e.g. 00:00–00:00) means open 24 hours.
  if (isTwentyFourHours(day)) return "Open 24 hours";
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
      <Icon icon="check" size="medium" style={{ color: "var(--color-success)" }} aria-label="Yes" />
    );
  }
  if (value === false) {
    return (
      <Icon
        icon="xmark"
        size="medium"
        style={{ color: "var(--color-accent-pink)" }}
        aria-label="No"
      />
    );
  }
  return (
    <Icon
      icon="question"
      size="medium"
      style={{ color: "var(--color-neutral-grey)" }}
      aria-label="Unknown"
    />
  );
}

export const REMOVED_MESSAGE = "This toilet has been removed from the map";
export const SAVED_MESSAGE = "Thanks — your changes are live.";

interface ToiletDetailsPanelProps {
  toilet: LooDetail;
  onClose: () => void;
  /** Optional message shown at the top of the panel (e.g. the "changes are live" banner). */
  notice?: ComponentChildren;
  /**
   * The toilet is no longer on the map (deleted, or marked inactive since it was opened).
   * Shows a removed notice and hides the directions and edit actions.
   */
  removed?: boolean;
  /** Show the dismissible "your changes are live" banner (after a save, `?saved=1`). */
  saved?: boolean;
  onDismissSaved?: () => void;
}

export default function ToiletDetailsPanel({
  toilet,
  onClose,
  notice,
  removed = false,
  saved = false,
  onDismissSaved,
}: ToiletDetailsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const today = todayIndex();

  const directionsUrl =
    toilet.location && !removed
      ? `https://maps.apple.com/?dirflg=w&daddr=${toilet.location.lat},${toilet.location.lng}`
      : null;

  const showSaved = saved && !removed;
  const notices =
    notice || removed || showSaved ? (
      <div className={styles.notices}>
        {removed && (
          <div role="status">
            <Banner variant="info">{REMOVED_MESSAGE}.</Banner>
          </div>
        )}
        {showSaved && (
          <div role="status">
            <Banner variant="success">
              <div className={styles.noticeRow}>
                <span>{SAVED_MESSAGE}</span>
                {onDismissSaved && (
                  <button
                    type="button"
                    className={styles.noticeDismiss}
                    aria-label="Dismiss message"
                    onClick={onDismissSaved}
                  >
                    <Icon icon="xmark" size="small" />
                  </button>
                )}
              </div>
            </Banner>
          </div>
        )}
        {notice}
      </div>
    ) : null;

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
        {notices}
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
        {notices}
        <div className={styles.grid}>
          {/* Column 1: Details */}
          <Stack space="m">
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
            {!removed && (
              <div>
                <p className={styles.verifyPrompt}>Is this information correct?</p>
                <div className={styles.verifyActions}>
                  <Button htmlElement="button" variant="primary">
                    Yes
                  </Button>
                  <span className={styles.verifyNoSpan}>
                    No?{" "}
                    <Button htmlElement="a" variant="secondary" href={`/loos/${toilet.id}/edit`}>
                      <Icon icon="pen-to-square" size="small" />
                      Edit
                    </Button>
                  </span>
                </div>
              </div>
            )}
            {toilet.notes?.trim() && (
              <div>
                <h3 className={styles.colHeading}>Notes</h3>
                <p className={styles.notes}>{toilet.notes.trim()}</p>
              </div>
            )}
            <p className={styles.updatedAt}>Last updated: {formatUpdatedAt(toilet.updatedAt)}</p>
          </Stack>

          {/* Column 2: Features */}
          <div>
            <h3 className={styles.colHeading}>Features</h3>
            <ul className={styles.featureList}>
              {FEATURES.map(({ key, label, icon }) => (
                <li key={key} className={styles.featureItem}>
                  <span className={styles.featureLabel}>
                    <Icon icon={icon} size="medium" />
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
            {toilet.openingTimes === null || toilet.openingTimes === undefined ? (
              <p className={styles.hoursUnknown}>Opening hours not known</p>
            ) : (
              <ul className={styles.hoursList}>
                {DAYS.map((day, i) => {
                  const dayEntry = toilet.openingTimes?.[i];
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
            )}
            {!removed && (
              <p className={styles.hoursNote}>
                Hours may vary with national holidays or seasonal changes.{" "}
                <a href={`/loos/${toilet.id}/edit`}>Edit this toilet</a> if out of date.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
