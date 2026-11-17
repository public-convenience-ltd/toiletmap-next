import { londonClock } from "@toiletmap/opening-hours";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { BottomSheet, Button, Icon } from "toiletmap-design-system";
import { type LooDetail, peekLooDetail } from "../../api/loos";
import {
  type ChangeOutcome,
  type PendingChange,
  readPendingChange,
  rememberPendingChange,
  restoreLoo,
  verifyLoo,
} from "../../api/reports";
import {
  directionsUrl,
  distanceText,
  keyFeatures,
  type LatLng,
  openStatus,
  paymentText,
  REMOVED_MESSAGE,
  removalSummary,
} from "./format";
import {
  type PanelLayout,
  type PanelState,
  useLayoutReporter,
  usePanelMode,
  useSummaryHeight,
} from "./layout";
import ToiletDetails, { type VerifyState } from "./ToiletDetails";
import styles from "./ToiletDetailsPanel.module.css";
import ToiletSummary from "./ToiletSummary";

export type { LatLng } from "./format";
export { freshnessLine, REMOVED_MESSAGE, removalSummary } from "./format";
export type { Occludes, PanelLayout, PanelMode, PanelState } from "./layout";
export { VERIFIED_MESSAGE, VERIFY_LABEL } from "./ToiletDetails";

export const SAVED_MESSAGE = "Thanks — your changes are live.";
export const PENDING_MESSAGE = "You suggested a change to this toilet — it's awaiting review.";
export const RESTORED_MESSAGE = "Thanks — it's back on the map.";
export const RESTORE_QUEUED_MESSAGE = "Thanks — a moderator will review your request.";
/** The restore button, for someone whose restore a moderator checks first. */
export const RESTORE_BUTTON_LABEL = "It's still here — ask to restore";
/** The restore button, for someone whose restore goes live straight away. */
export const RESTORE_NOW_BUTTON_LABEL = "It's still here — restore it";

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

/** Where focus goes when the panel closes: the opener, else the map's search box. */
function focusReturnTarget(returnFocusTo: HTMLElement | null | undefined) {
  const target =
    returnFocusTo?.isConnected === true
      ? returnFocusTo
      : document.querySelector<HTMLElement>('input[type="search"]');
  target?.focus({ preventScroll: true });
}

type RestoreState = { status: "idle" | "sending" } | { status: "done"; outcome: ChangeOutcome };

type NoticeTone = "success" | "info" | "warning" | "error";

/** One slim notice line in the summary. */
function NoticeLine({
  tone,
  children,
  action,
}: {
  tone: NoticeTone;
  children: ComponentChildren;
  action?: ComponentChildren;
}) {
  return (
    <div className={styles.notice} data-tone={tone}>
      <Icon
        icon={tone === "success" ? "check" : tone === "info" ? "info" : "warning"}
        size="small"
        class={styles.noticeIcon}
      />
      <div className={styles.noticeText}>{children}</div>
      {action}
    </div>
  );
}

export interface ToiletDetailsPanelProps {
  toilet: LooDetail;
  onClose: () => void;
  /** Base URL for API calls; "" (the same-origin /api proxy) by default. */
  apiUrl?: string;
  /** Optional slim message in the summary (e.g. an offline / stale-data notice). */
  notice?: ComponentChildren;
  /**
   * The toilet is no longer on the map (deleted, or marked inactive since it was opened).
   * Shows a removed notice and hides the directions and edit actions. A toilet whose
   * `active` is false is shown as removed without this.
   */
  removed?: boolean;
  /** Show the dismissible "your changes are live" notice (after a save, `?saved=1`). */
  saved?: boolean;
  onDismissSaved?: () => void;
  /**
   * The viewer's changes go live straight away (signed in with `report:loo` or
   * `access:admin`): the restore prompt then says it will be put back at once, and otherwise
   * that a moderator will check first.
   */
  canWriteDirectly?: boolean;
  /** The viewer's location, for the distance in the summary. */
  userLocation?: LatLng | null;
  /** Open with the details showing (the summary is the default). `?restore=1` also opens them. */
  initialExpanded?: boolean;
  /** Where focus returns when the panel closes; the map's search input otherwise. */
  returnFocusTo?: HTMLElement | null;
  /**
   * Called whenever the panel's size or position changes (contract P1): what it covers of the
   * map container, so the map can keep the selected marker clear of it.
   */
  onLayoutChange?: (layout: PanelLayout) => void;
  /** Desktop card: px from the top of the map container (below the search bar). */
  cardTop?: number;
}

/**
 * The toilet details panel. A marker tap shows the compact summary (name, distance, open now,
 * key features, Directions and Details); Details expands the rest.
 *
 * - Below 768px: a non-modal bottom sheet (peek / expanded, capped at 60% of the map).
 * - From 768px: a floating card on the left, under the search bar, scrolling inside.
 *
 * Close (the X) always closes. Escape inside the panel collapses the details first, then
 * closes, as do the sheet's handle and the Details toggle. Focus moves to the heading on open
 * and back to `returnFocusTo` (or the search box) on close.
 *
 * On short screens (a phone in landscape, ≥768px wide but ≤560px tall) the card scrolls as a
 * whole, so its summary, notices and actions can't be squeezed out of reach.
 *
 * Positions itself absolutely: render it directly inside the (positioned) map container.
 */
export default function ToiletDetailsPanel({
  toilet,
  onClose,
  apiUrl = "",
  notice,
  removed = false,
  saved = false,
  onDismissSaved,
  canWriteDirectly = false,
  userLocation = null,
  initialExpanded = false,
  returnFocusTo,
  onLayoutChange,
  cardTop,
}: ToiletDetailsPanelProps) {
  const mode = usePanelMode();
  const uid = useId();
  const titleId = `${uid}-title`;
  const detailsId = `${uid}-details`;
  const [expanded, setExpanded] = useState(
    () => initialExpanded || (hasRestoreParam(toilet.id) && (removed || toilet.active === false)),
  );
  const panelState: PanelState = expanded ? "expanded" : "peek";

  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const detailsToggleRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(returnFocusTo);
  returnFocusRef.current = returnFocusTo;

  const now = new Date();
  const today = londonClock(now).dayIndex;

  /** The toilet as changed by an action in this panel (a restore), until the prop changes. */
  const [local, setLocal] = useState<{ base: LooDetail; value: LooDetail } | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ status: "idle" });
  const [restore, setRestore] = useState<RestoreState>({ status: "idle" });
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreDetails, setRestoreDetails] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(() => readPendingChange(toilet.id));
  const restoreHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreResultRef = useRef<HTMLDivElement>(null);
  const restoreActionRef = useRef<HTMLDivElement>(null);

  const override = local && local.base === toilet ? local.value : null;
  // When the map says the toilet has gone, its refetched (inactive) detail may be cached:
  // use it for the removal reason. The prop can still be the copy from before the removal.
  const peeked = removed && !override ? peekLooDetail(toilet.id) : null;
  const current: LooDetail =
    override ?? (peeked && peeked.id === toilet.id && peeked.active === false ? peeked : toilet);
  const isRemoved = override ? override.active === false : removed || current.active === false;
  /** We have the removed record itself, so it can be restored from here. */
  const canRestore = isRemoved && current.active === false;
  const summary = canRestore ? removalSummary(current) : null;
  const duplicateOf =
    isRemoved && typeof current.duplicateOf === "string" && current.duplicateOf
      ? current.duplicateOf
      : null;

  const looHref = `/loos/${encodeURIComponent(toilet.id)}`;
  const directionsHref = current.location && !isRemoved ? directionsUrl(current.location) : null;

  useLayoutReporter(rootRef, mode, panelState, onLayoutChange);
  // The expanded sheet's summary is sticky: its scroller pads its top by the summary's height.
  useSummaryHeight(rootRef, summaryRef, mode === "sheet" && expanded);

  // Focus the heading on open, and hand focus back on close if it was still in the panel
  // (closed from outside: Escape on the map, Back, another marker).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      const root = rootRef.current;
      const active = document.activeElement;
      if (!active || active === document.body || root?.contains(active)) {
        focusReturnTarget(returnFocusRef.current);
      }
    };
  }, []);

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

  const setPanelState = (next: PanelState) => {
    if (next === "peek") {
      // Focus inside the details would be lost when they unmount: keep it on the toggle.
      const details = document.getElementById(detailsId);
      if (details?.contains(document.activeElement)) detailsToggleRef.current?.focus();
    }
    setExpanded(next === "expanded");
  };

  const close = () => {
    focusReturnTarget(returnFocusRef.current);
    onClose();
  };

  /** Escape: collapse the details first, then close (legacy behaviour). */
  const dismiss = () => {
    if (expanded) setPanelState("peek");
    else close();
  };

  const onCardKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    // Scoped to the panel: the map's own Escape handler would close it outright.
    event.stopPropagation();
    dismiss();
  };

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

  const openRestore = () => {
    setExpanded(true);
    setRestoreOpen(true);
  };

  const cancelRestore = () => {
    setRestoreOpen(false);
    setRestore({ status: "idle" });
    // The prompt's trigger comes back on the next render.
    requestAnimationFrame(() => restoreActionRef.current?.querySelector("button")?.focus());
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
        return <NoticeLine tone="success">{RESTORED_MESSAGE}</NoticeLine>;
      case "queued":
        return <NoticeLine tone="success">{RESTORE_QUEUED_MESSAGE}</NoticeLine>;
      case "notRemoved":
        return <NoticeLine tone="info">It's already back on the map.</NoticeLine>;
      case "conflict":
        return (
          <NoticeLine tone="warning">
            Someone else changed this toilet since you opened it.{" "}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>{" "}
            to see the latest version.
          </NoticeLine>
        );
      case "notFound":
        return (
          <NoticeLine tone="error">
            We couldn't find this toilet — it may have been deleted.
          </NoticeLine>
        );
      case "auth":
        return (
          <NoticeLine tone="error">
            Your sign-in has expired.{" "}
            <a href={`/auth/login?returnTo=${encodeURIComponent(`${looHref}?restore=1`)}`}>
              Sign in again
            </a>{" "}
            to restore it.
          </NoticeLine>
        );
      case "rateLimited":
        return (
          <NoticeLine tone="error">
            You've sent a lot of requests in a short time. Please try again later.
          </NoticeLine>
        );
      case "error":
        return <NoticeLine tone="error">{r.message}</NoticeLine>;
      default:
        return null;
    }
  })();

  const notices =
    notice || isRemoved || showSaved || showPending || restoreResult ? (
      <div className={styles.notices}>
        {isRemoved && (
          <div role="status">
            <NoticeLine tone="warning">
              <p className={styles.noticeParagraph}>{summary ?? `${REMOVED_MESSAGE}.`}</p>
              {duplicateOf && (
                <p className={styles.noticeParagraph}>
                  <a href={`/loos/${encodeURIComponent(duplicateOf)}`}>
                    See the toilet it duplicates
                  </a>
                </p>
              )}
            </NoticeLine>
          </div>
        )}
        {restoreResult && (
          <div ref={restoreResultRef} tabIndex={-1} role="status" className={styles.focusTarget}>
            {restoreResult}
          </div>
        )}
        {showSaved && (
          <div role="status">
            <NoticeLine
              tone="success"
              action={
                onDismissSaved && (
                  <button
                    type="button"
                    className={styles.noticeDismiss}
                    aria-label="Dismiss message"
                    onClick={onDismissSaved}
                  >
                    <Icon icon="xmark" size="small" />
                  </button>
                )
              }
            >
              {SAVED_MESSAGE}
            </NoticeLine>
          </div>
        )}
        {showPending && (
          <div role="status">
            <NoticeLine tone="info">{PENDING_MESSAGE}</NoticeLine>
          </div>
        )}
        {notice && <div className={styles.noticeSlot}>{notice}</div>}
      </div>
    ) : null;

  const restoreAction =
    canRestore && !restoreOpen && !restoreSucceeded ? (
      <div className={styles.restoreAction} ref={restoreActionRef}>
        <Button htmlElement="button" type="button" variant="primary" onClick={openRestore}>
          {canWriteDirectly ? RESTORE_NOW_BUTTON_LABEL : RESTORE_BUTTON_LABEL}
        </Button>
      </div>
    ) : null;

  const restorePrompt =
    canRestore && restoreOpen ? (
      <form
        className={styles.restorePrompt}
        onSubmit={onRestore}
        aria-labelledby={`${uid}-restore-heading`}
      >
        <h3
          id={`${uid}-restore-heading`}
          className={styles.sectionHeading}
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
            <label htmlFor={`${uid}-restore-details`} className={styles.restoreLabel}>
              Anything we should know? (optional)
            </label>
            <textarea
              id={`${uid}-restore-details`}
              className={`text-area ${styles.restoreTextarea}`}
              rows={3}
              maxLength={2000}
              value={restoreDetails}
              onInput={(e) => setRestoreDetails((e.currentTarget as HTMLTextAreaElement).value)}
            />
          </>
        )}
        <div className={styles.detailActions}>
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

  const summaryView = (
    <ToiletSummary
      name={current.name?.trim() || "Toilet"}
      titleId={titleId}
      headingRef={headingRef}
      summaryRef={summaryRef}
      distance={isRemoved ? null : distanceText(userLocation, current.location)}
      status={isRemoved ? null : openStatus(current.openingTimes, now)}
      features={isRemoved ? [] : keyFeatures(current)}
      payment={isRemoved ? null : paymentText(current)}
      directionsHref={directionsHref}
      restoreAction={restoreAction}
      expanded={expanded}
      detailsId={detailsId}
      detailsToggleRef={detailsToggleRef}
      onToggleDetails={() => setPanelState(expanded ? "peek" : "expanded")}
      onClose={close}
      notices={notices}
    />
  );

  const detailsView = expanded ? (
    <ToiletDetails
      id={detailsId}
      toilet={current}
      isRemoved={isRemoved}
      today={today}
      verify={verify}
      onVerify={onVerify}
      verifiedAt={verify.status === "done" ? verify.verifiedAt : current.verifiedAt}
      restorePrompt={restorePrompt}
    />
  ) : null;

  if (mode === "sheet") {
    return (
      <BottomSheet
        sheetRef={rootRef}
        class={`toilet-panel ${styles.panel} ${styles.sheet}`}
        state={panelState}
        onStateChange={setPanelState}
        onDismiss={close}
        aria-labelledby={titleId}
        handleLabel="Toilet details"
        controls={expanded ? detailsId : undefined}
      >
        {summaryView}
        {detailsView}
      </BottomSheet>
    );
  }

  return (
    <section
      ref={rootRef}
      className={`toilet-panel ${styles.panel} ${styles.card}`}
      aria-labelledby={titleId}
      data-state={panelState}
      style={cardTop === undefined ? undefined : { "--toilet-panel-top": `${cardTop}px` }}
      onKeyDown={onCardKeyDown}
    >
      {summaryView}
      {detailsView && <div className={styles.cardBody}>{detailsView}</div>}
    </section>
  );
}
