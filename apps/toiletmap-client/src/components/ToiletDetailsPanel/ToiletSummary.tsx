import type { ComponentChildren, Ref } from "preact";
import { Button, Icon } from "toiletmap-design-system";
import type { KeyFeature, StatusTone } from "./format";
import styles from "./ToiletDetailsPanel.module.css";

export interface ToiletSummaryProps {
  name: string;
  titleId: string;
  headingRef: Ref<HTMLHeadingElement>;
  /** The summary's (pinned header's) root, measured for the expanded sheet's scroll padding. */
  summaryRef?: Ref<HTMLDivElement>;
  /** "350 m away", or null when the viewer's location is unknown. */
  distance: string | null;
  /** The open-now chip; null for a removed toilet. */
  status: { tone: StatusTone; text: string } | null;
  features: KeyFeature[];
  /** "Free", "Paid" or "Paid: 20p"; null when not known (or removed). */
  payment: string | null;
  /** Directions link, or null (no location, or removed). */
  directionsHref: string | null;
  /** Shown in place of Directions for a removed toilet that can be restored. */
  restoreAction?: ComponentChildren;
  expanded: boolean;
  /**
   * The expanded bottom sheet: pin only a compact header (name, distance / open now, the
   * Details and Close buttons) and move the rest to the top of the scrolling content.
   */
  compact?: boolean;
  detailsId: string;
  detailsToggleRef: Ref<HTMLButtonElement>;
  onToggleDetails: () => void;
  onClose: () => void;
  /** Compact DS Notices: removed, pending, offline, restore result. */
  notices?: ComponentChildren;
}

/**
 * The top of the panel, above the details it opens with: all that shows once the Details
 * toggle (or the sheet's handle) collapses it.
 *
 * In the expanded bottom sheet (`compact`) only a slim header stays pinned: the name (at most
 * three lines) beside the collapse (Details) and Close buttons, and below them, across the full
 * width so the open-now status isn't cut short, the distance / open-now line. The
 * key features, the Free / Paid chip, any notices and Directions move to the top of the
 * scrolling content just below it, so the details get most of the sheet. Everywhere else (the
 * collapsed sheet, the desktop card) it is one block: name, a meta line with everything, any
 * notices, then Directions and Details.
 */
export default function ToiletSummary({
  name,
  titleId,
  headingRef,
  summaryRef,
  distance,
  status,
  features,
  payment,
  directionsHref,
  restoreAction,
  expanded,
  compact = false,
  detailsId,
  detailsToggleRef,
  onToggleDetails,
  onClose,
  notices,
}: ToiletSummaryProps) {
  const distanceItem = distance && <span className={styles.distance}>{distance}</span>;
  const statusItem = status && (
    <span className={styles.statusChip} data-tone={status.tone} data-testid="open-now">
      {status.text}
    </span>
  );
  const paymentItem = payment && (
    <span className={styles.paymentChip} data-testid="payment">
      {payment}
    </span>
  );
  // Words, not bare icons: "Accessible", "Baby changing", "RADAR key", "All-gender".
  const featuresItem = features.length > 0 && (
    <ul className={styles.keyFeatures} aria-label="Key features">
      {features.map((feature) => (
        <li key={feature.key} className={styles.keyFeature}>
          <Icon icon={feature.icon} size="small" />
          {feature.label}
        </li>
      ))}
    </ul>
  );
  const directions = directionsHref && (
    <Button
      htmlElement="a"
      variant="primary"
      href={directionsHref}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon icon="diamond-turn-right" size="small" />
      Directions
    </Button>
  );
  const toggleProps = {
    ref: detailsToggleRef,
    type: "button" as const,
    "aria-expanded": expanded,
    "aria-controls": expanded ? detailsId : undefined,
    onClick: onToggleDetails,
  };

  // One line in the pinned header, the full width below the name and the buttons: distance
  // and open now (the rest moves below the header).
  const meta = compact
    ? (distance || status) && (
        <div className={styles.meta}>
          {distanceItem}
          {statusItem}
        </div>
      )
    : (distance || status || payment || features.length > 0) && (
        // One wrapping line: distance, open now, payment and the key feature icons.
        <div className={styles.meta}>
          {distanceItem}
          {statusItem}
          {paymentItem}
          {featuresItem}
        </div>
      );

  return (
    <>
      <div
        className={compact ? `${styles.summary} ${styles.compactHeader}` : styles.summary}
        ref={summaryRef}
      >
        <div className={styles.summaryHeader}>
          <div className={styles.titleBlock}>
            <h2 id={titleId} className={styles.name} tabIndex={-1} ref={headingRef}>
              {name}
            </h2>
            {!compact && meta}
          </div>
          <div className={styles.headerControls}>
            {/* Pinned with the name, so the sheet can be collapsed from anywhere in it. */}
            {compact && (
              <button {...toggleProps} className={styles.iconButton} aria-label="Details">
                <Icon icon="chevron-down" size="small" />
              </button>
            )}
            {/* Always closes the panel: the handle, Details and Escape collapse it. */}
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Close"
              onClick={onClose}
            >
              <Icon icon="xmark" size="medium" />
            </button>
          </div>
        </div>

        {compact && meta}

        {!compact && notices}

        {!compact && (
          <div className={styles.summaryActions}>
            {directions}
            {restoreAction}
            <button {...toggleProps} className={`button button--secondary ${styles.detailsToggle}`}>
              Details
              <Icon icon="chevron-down" size="small" class={styles.chevron} />
            </button>
          </div>
        )}
      </div>

      {/* The expanded sheet: first thing in the scrolling content, just below the header. */}
      {compact && (
        <div className={styles.summaryExtras}>
          {notices}
          {(directions || restoreAction || paymentItem || featuresItem) && (
            <div className={`${styles.summaryActions} ${styles.extrasRow}`}>
              {directions}
              {restoreAction}
              {paymentItem}
              {featuresItem}
            </div>
          )}
        </div>
      )}
    </>
  );
}
