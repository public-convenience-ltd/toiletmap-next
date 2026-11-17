import {
  DAYS,
  formatRange,
  isOpenNow,
  londonClock,
  summariseOpeningTimes,
} from "@toiletmap/opening-hours";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "toiletmap-design-system";
import { Banner, Button, Icon, Stack } from "toiletmap-design-system";
import { type LooDetail, peekLooDetail } from "../../api/loos";
import {
  type ChangeOutcome,
  type PendingChange,
  readPendingChange,
  rememberPendingChange,
  removalCategoryLabel,
  restoreLoo,
  verifyLoo,
} from "../../api/reports";
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

/** Today's index (Mon = 0) in UK local time, matching how the hours are stored. */
function todayIndex(now: Date): number {
  return londonClock(now).dayIndex;
}

function formatDayHours(day: [string, string] | [] | undefined): string {
  if (day === undefined) return "Not known";
  return formatRange(day);
}

function openNowText(openingTimes: LooDetail["openingTimes"], now: Date): string | null {
  const status = isOpenNow(openingTimes, now);
  if (status.state === "open") {
    return status.closesAt ? `Open now · closes ${status.closesAt}` : "Open now";
  }
  if (status.state === "closed") {
    return status.opensAt ? `Closed now · opens ${status.opensAt}` : "Closed now";
  }
  return null;
}

/**
 * The freshness line: whichever of the last verification and the last edit is more recent,
 * with the matching label (verifying doesn't bump `updatedAt`, and an edit doesn't verify).
 */
export function freshnessLine(
  verifiedAt: string | null | undefined,
  updatedAt: string | null | undefined,
): string {
  const time = (iso: string | null | undefined) => {
    const ms = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  const verified = time(verifiedAt);
  const updated = time(updatedAt);
  if (verified !== null && (updated === null || verified >= updated)) {
    return `Last verified: ${formatUpdatedAt(verifiedAt ?? null)}`;
  }
  return `Last updated: ${formatUpdatedAt(updated === null ? null : (updatedAt ?? null))}`;
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
export const PENDING_MESSAGE = "You suggested a change to this toilet — it's awaiting review.";
export const VERIFIED_MESSAGE = "Thanks!";
export const RESTORED_MESSAGE = "Thanks — it's back on the map.";
export const RESTORE_QUEUED_MESSAGE = "Thanks — a moderator will review your request.";

/**
 * "Removed from the map: <category> — <reason>" for a removed toilet, or null when neither is
 * recorded (the generic {@link REMOVED_MESSAGE} is shown instead).
 */
export function removalSummary(toilet: LooDetail): string | null {
  const label = removalCategoryLabel(toilet.removalCategory);
  const reason = typeof toilet.removalReason === "string" ? toilet.removalReason.trim() : "";
  if (!label && !reason) return null;
  return `Removed from the map${label ? `: ${label}` : ""}${reason ? ` — ${reason}` : ""}`;
}

/** Reads (without consuming) `?restore=1` when the address bar is on this toilet's page. */
function hasRestoreParam(id: string): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return (
    url.pathname === `/loos/${encodeURIComponent(id)}` && url.searchParams.get("restore") === "1"
  );
}

/** Strips `restore` from the address bar, so a reload doesn't reopen the prompt. */
function stripRestoreParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("restore")) return;
  url.searchParams.delete("restore");
  const search = url.searchParams.toString();
  history.replaceState(
    history.state,
    "",
    `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
  );
}

type VerifyState =
  | { status: "idle" | "sending" }
  | { status: "done"; verifiedAt: string }
  | { status: "error"; message: string };

type RestoreState = { status: "idle" | "sending" } | { status: "done"; outcome: ChangeOutcome };

interface ToiletDetailsPanelProps {
  toilet: LooDetail;
  onClose: () => void;
  /** Base URL for API calls; "" (the same-origin /api proxy) by default. */
  apiUrl?: string;
  /** Optional message shown at the top of the panel (e.g. the "changes are live" banner). */
  notice?: ComponentChildren;
  /**
   * The toilet is no longer on the map (deleted, or marked inactive since it was opened).
   * Shows a removed notice and hides the directions and edit actions. A toilet whose
   * `active` is false is shown as removed without this.
   */
  removed?: boolean;
  /** Show the dismissible "your changes are live" banner (after a save, `?saved=1`). */
  saved?: boolean;
  onDismissSaved?: () => void;
  /**
   * The viewer's changes go live straight away (signed in with `report:loo` or
   * `access:admin`): the restore prompt then says it will be put back at once, and otherwise
   * that a moderator will check first.
   */
  canWriteDirectly?: boolean;
}

export default function ToiletDetailsPanel({
  toilet,
  onClose,
  apiUrl = "",
  notice,
  removed = false,
  saved = false,
  onDismissSaved,
  canWriteDirectly = false,
}: ToiletDetailsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const now = new Date();
  const today = todayIndex(now);

  /** The toilet as changed by an action in this panel (a restore), until the prop changes. */
  const [local, setLocal] = useState<{ base: LooDetail; value: LooDetail } | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ status: "idle" });
  const [restore, setRestore] = useState<RestoreState>({ status: "idle" });
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreDetails, setRestoreDetails] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(() => readPendingChange(toilet.id));
  const restoreHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreResultRef = useRef<HTMLDivElement>(null);
  const restoreActionsRef = useRef<HTMLDivElement>(null);

  const override = local && local.base === toilet ? local.value : null;
  // When the map says the toilet has gone, its refetched (inactive) detail may be cached:
  // use it for the removal reason. The prop can still be the copy from before the removal.
  const peeked = removed && !override ? peekLooDetail(toilet.id) : null;
  const current: LooDetail =
    override ?? (peeked && peeked.id === toilet.id && peeked.active === false ? peeked : toilet);
  const isRemoved = override ? override.active === false : removed || current.active === false;
  const openNow = isRemoved ? null : openNowText(current.openingTimes, now);
  /** We have the removed record itself, so it can be restored from here. */
  const canRestore = isRemoved && current.active === false;
  const summary = isRemoved && current.active === false ? removalSummary(current) : null;
  const duplicateOf =
    isRemoved && typeof current.duplicateOf === "string" && current.duplicateOf
      ? current.duplicateOf
      : null;

  const looHref = `/loos/${encodeURIComponent(toilet.id)}`;
  const directionsUrl =
    current.location && !isRemoved
      ? `https://maps.apple.com/?dirflg=w&daddr=${current.location.lat},${current.location.lng}`
      : null;

  // `?restore=1` (e.g. from the add form's "Is it back? Restore it") opens the restore prompt.
  useEffect(() => {
    if (!hasRestoreParam(toilet.id)) return;
    stripRestoreParam();
    if (canRestore) setRestoreOpen(true);
  }, []);

  useEffect(() => {
    if (restoreOpen) restoreHeadingRef.current?.focus();
  }, [restoreOpen]);

  useEffect(() => {
    if (restore.status === "done") restoreResultRef.current?.focus();
  }, [restore.status]);

  const onVerify = async () => {
    if (verify.status === "sending") return;
    setVerify({ status: "sending" });
    const result = await verifyLoo(apiUrl, toilet.id);
    if (result.kind === "verified") {
      setVerify({ status: "done", verifiedAt: result.verifiedAt ?? new Date().toISOString() });
    } else if (result.kind === "removed") {
      setVerify({ status: "error", message: `${REMOVED_MESSAGE}.` });
    } else if (result.kind === "notFound") {
      setVerify({ status: "error", message: "We couldn't find this toilet any more." });
    } else if (result.kind === "rateLimited") {
      setVerify({
        status: "error",
        message: "You've done that a lot in a short time. Please try again later.",
      });
    } else {
      setVerify({ status: "error", message: result.message });
    }
  };

  const onRestore = async (event: Event) => {
    event.preventDefault();
    if (restore.status === "sending") return;
    setRestore({ status: "sending" });
    const result = await restoreLoo(apiUrl, toilet.id, {
      details: canWriteDirectly ? undefined : restoreDetails,
      baseUpdatedAt: current.updatedAt,
    });
    if (result.kind === "applied") {
      setLocal({ base: toilet, value: { ...current, ...result.loo } });
      setRestoreOpen(false);
    } else if (result.kind === "queued") {
      rememberPendingChange(toilet.id, "restore", result.pendingId);
      setPending(readPendingChange(toilet.id));
      setRestoreOpen(false);
    }
    setRestore({ status: "done", outcome: result });
  };

  const cancelRestore = () => {
    setRestoreOpen(false);
    setRestore({ status: "idle" });
    // The prompt's trigger comes back on the next render.
    requestAnimationFrame(() => restoreActionsRef.current?.querySelector("button")?.focus());
  };

  const restoreSucceeded =
    restore.status === "done" &&
    (restore.outcome.kind === "applied" || restore.outcome.kind === "queued");

  const showSaved = saved && !isRemoved;
  const showPending =
    !!pending && !(restore.status === "done" && restore.outcome.kind === "queued");

  const restoreResult = (() => {
    if (restore.status !== "done") return null;
    const r = restore.outcome;
    switch (r.kind) {
      case "applied":
        return <Banner variant="success">{RESTORED_MESSAGE}</Banner>;
      case "queued":
        return <Banner variant="success">{RESTORE_QUEUED_MESSAGE}</Banner>;
      case "notRemoved":
        return <Banner variant="info">It's already back on the map.</Banner>;
      case "conflict":
        return (
          <Banner variant="warning">
            Someone else changed this toilet since you opened it.{" "}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>{" "}
            to see the latest version.
          </Banner>
        );
      case "notFound":
        return (
          <Banner variant="error">We couldn't find this toilet — it may have been deleted.</Banner>
        );
      case "auth":
        return (
          <Banner variant="error">
            Your sign-in has expired.{" "}
            <a href={`/auth/login?returnTo=${encodeURIComponent(`${looHref}?restore=1`)}`}>
              Sign in again
            </a>{" "}
            to restore it.
          </Banner>
        );
      case "rateLimited":
        return (
          <Banner variant="error">
            You've sent a lot of requests in a short time. Please try again later.
          </Banner>
        );
      case "error":
        return <Banner variant="error">{r.message}</Banner>;
      default:
        return null;
    }
  })();

  const removedNotice = isRemoved ? (
    <div role="status" className={styles.removedNotice}>
      <Banner variant="info">
        <p className={styles.removedText}>{summary ?? `${REMOVED_MESSAGE}.`}</p>
        {duplicateOf && (
          <p className={styles.removedText}>
            <a href={`/loos/${encodeURIComponent(duplicateOf)}`}>See the toilet it duplicates</a>
          </p>
        )}
        {canRestore && !restoreOpen && !restoreSucceeded && (
          <div className={styles.removedActions} ref={restoreActionsRef}>
            <Button
              htmlElement="button"
              type="button"
              variant="secondary"
              onClick={() => setRestoreOpen(true)}
            >
              It's still here — ask to restore
            </Button>
          </div>
        )}
      </Banner>
    </div>
  ) : null;

  const restorePrompt =
    canRestore && restoreOpen ? (
      <form className={styles.restorePrompt} onSubmit={onRestore} aria-labelledby="restore-heading">
        <h3
          id="restore-heading"
          className={styles.colHeading}
          tabIndex={-1}
          ref={restoreHeadingRef}
        >
          Is it still here?
        </h3>
        <p className={styles.restoreText}>
          {canWriteDirectly
            ? `If ${current.name?.trim() || "this toilet"} is still here and open to the public, it will go back on the map straight away.`
            : `If ${current.name?.trim() || "this toilet"} is still here and open to the public, tell us and a moderator will check before it goes back on the map.`}
        </p>
        {/* A trusted restore is applied straight away and the server ignores its details. */}
        {!canWriteDirectly && (
          <>
            <label htmlFor={`restore-details-${toilet.id}`} className={styles.restoreLabel}>
              Anything we should know? (optional)
            </label>
            <textarea
              id={`restore-details-${toilet.id}`}
              className={`text-area ${styles.restoreTextarea}`}
              rows={3}
              maxLength={2000}
              value={restoreDetails}
              onInput={(e) => setRestoreDetails((e.currentTarget as HTMLTextAreaElement).value)}
            />
          </>
        )}
        <div className={styles.removedActions}>
          <Button
            htmlElement="button"
            type="submit"
            variant="primary"
            disabled={restore.status === "sending"}
          >
            {restore.status === "sending" ? "Sending…" : "Restore it"}
          </Button>
          <Button
            htmlElement="button"
            type="button"
            variant="secondary"
            onClick={cancelRestore}
            disabled={restore.status === "sending"}
          >
            Cancel
          </Button>
        </div>
      </form>
    ) : null;

  const notices =
    notice || isRemoved || showSaved || showPending || restoreResult ? (
      <div className={styles.notices}>
        {removedNotice}
        {restorePrompt}
        {restoreResult && (
          <div ref={restoreResultRef} tabIndex={-1} role="status" className={styles.focusTarget}>
            {restoreResult}
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
        {showPending && (
          <div role="status">
            <Banner variant="info">{PENDING_MESSAGE}</Banner>
          </div>
        )}
        {notice}
      </div>
    ) : null;

  const verifiedAt = verify.status === "done" ? verify.verifiedAt : current.verifiedAt;

  if (!isExpanded) {
    return (
      <div className={styles.collapsed}>
        <div className={styles.collapsedHeader}>
          <h2 className={styles.name}>{current.name ?? "Toilet"}</h2>
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
            <h2 className={styles.name}>{current.name ?? "Toilet"}</h2>
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
            {!isRemoved && (
              <div>
                <p className={styles.verifyPrompt}>Is this toilet still here?</p>
                <div className={styles.verifyActions}>
                  {verify.status !== "done" && (
                    <Button
                      htmlElement="button"
                      type="button"
                      variant="primary"
                      onClick={onVerify}
                      disabled={verify.status === "sending"}
                      aria-busy={verify.status === "sending"}
                    >
                      <Icon icon="check" size="small" />
                      Yes, it's still here
                    </Button>
                  )}
                  <Button htmlElement="a" variant="secondary" href={`${looHref}/edit`}>
                    <Icon icon="pen-to-square" size="small" />
                    Suggest an edit
                  </Button>
                  <Button htmlElement="a" variant="secondary" href={`${looHref}/remove`}>
                    <Icon icon="warning" size="small" />
                    Report a problem
                  </Button>
                </div>
                <div role="status" className={styles.verifyStatus}>
                  {verify.status === "done" && (
                    <span className={styles.verifyThanks}>
                      <Icon icon="check" size="small" />
                      {VERIFIED_MESSAGE}
                    </span>
                  )}
                  {verify.status === "error" && (
                    <span className={styles.verifyError}>{verify.message}</span>
                  )}
                </div>
              </div>
            )}
            {current.notes?.trim() && (
              <div>
                <h3 className={styles.colHeading}>Notes</h3>
                <p className={styles.notes}>{current.notes.trim()}</p>
              </div>
            )}
            <p className={styles.updatedAt}>{freshnessLine(verifiedAt, current.updatedAt)}</p>
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
                  <FeatureStatus value={current[key] as boolean | null | undefined} />
                </li>
              ))}
            </ul>
            {current.noPayment === false && (
              <div className={styles.feeSection}>
                <h4 className={styles.feeHeading}>Fee</h4>
                <p className={styles.feeDetail}>{current.paymentDetails ?? "Unknown"}</p>
              </div>
            )}
          </div>

          {/* Column 3: Opening Hours */}
          <div>
            <h3 className={styles.colHeading}>
              <Icon icon="clock" size="small" />
              Opening Hours
            </h3>
            {current.openingTimes === null || current.openingTimes === undefined ? (
              <p className={styles.hoursUnknown}>Opening hours not known</p>
            ) : (
              <>
                {openNow && (
                  <p className={styles.openNow} data-testid="open-now">
                    {openNow}
                  </p>
                )}
                <p className={styles.hoursSummary}>{summariseOpeningTimes(current.openingTimes)}</p>
                <ul className={styles.hoursList}>
                  {DAYS.map((day, i) => {
                    const dayEntry = current.openingTimes?.[i];
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
              </>
            )}
            {!isRemoved && (
              <p className={styles.hoursNote}>
                Hours may vary with national holidays or seasonal changes.{" "}
                <a href={`${looHref}/edit#hours`}>Edit this toilet</a> if out of date.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
