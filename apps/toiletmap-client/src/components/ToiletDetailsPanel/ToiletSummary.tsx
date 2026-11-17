import type { ComponentChildren, Ref } from "preact";
import { Button, Icon } from "toiletmap-design-system";
import type { KeyFeature, StatusTone } from "./format";
import styles from "./ToiletDetailsPanel.module.css";

export interface ToiletSummaryProps {
  name: string;
  titleId: string;
  headingRef: Ref<HTMLHeadingElement>;
  /** The summary's root, measured for the expanded sheet's scroll padding. */
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
  detailsId: string;
  detailsToggleRef: Ref<HTMLButtonElement>;
  onToggleDetails: () => void;
  onClose: () => void;
  /** Slim notice lines: saved, removed, pending, offline, restore result. */
  notices?: ComponentChildren;
}

/** The compact top of the panel: what a marker tap shows. */
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
  detailsId,
  detailsToggleRef,
  onToggleDetails,
  onClose,
  notices,
}: ToiletSummaryProps) {
  return (
    <div className={styles.summary} ref={summaryRef}>
      <div className={styles.summaryHeader}>
        <div className={styles.titleBlock}>
          <h2 id={titleId} className={styles.name} tabIndex={-1} ref={headingRef}>
            {name}
          </h2>
          {/* One wrapping line: distance, open now, payment and the key feature icons. */}
          {(distance || status || payment || features.length > 0) && (
            <div className={styles.meta}>
              {distance && <span className={styles.distance}>{distance}</span>}
              {status && (
                <span className={styles.statusChip} data-tone={status.tone} data-testid="open-now">
                  {status.text}
                </span>
              )}
              {payment && (
                <span className={styles.paymentChip} data-testid="payment">
                  {payment}
                </span>
              )}
              {features.length > 0 && (
                <ul className={styles.keyFeatures} aria-label="Key features">
                  {features.map((feature) => (
                    <li key={feature.key} className={styles.keyFeature} title={feature.label}>
                      <Icon icon={feature.icon} size="small" aria-label={feature.label} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {/* Always closes the panel: the handle, Details and Escape collapse it. */}
        <button type="button" className={styles.closeButton} aria-label="Close" onClick={onClose}>
          <Icon icon="xmark" size="medium" />
        </button>
      </div>

      {notices}

      <div className={styles.summaryActions}>
        {directionsHref && (
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
        )}
        {restoreAction}
        <button
          type="button"
          ref={detailsToggleRef}
          className={`button button--secondary ${styles.detailsToggle}`}
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          onClick={onToggleDetails}
        >
          Details
          <Icon icon="chevron-down" size="small" class={styles.chevron} />
        </button>
      </div>
    </div>
  );
}
