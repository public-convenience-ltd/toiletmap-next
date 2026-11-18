import { londonClock } from "@toiletmap/opening-hours";
import type { JSX } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { BottomSheet, Button, ConfirmDialog, Notice } from "toiletmap-design-system";
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

export interface ToiletDetailsPanelProps {
  toilet: LooDetail;
  onClose: () => void;
  /** Base URL for API calls; "" (the same-origin /api proxy) by default. */
  apiUrl?: string;
  /**
   * The map's offline / stale-data message, repeated here while the panel covers the map's
   * own. Shown, not announced: the map's copy is the live region.
   */
  notice?: string;
  /**
   * The toilet is no longer on the map (deleted, or marked inactive since it was opened).
   * Shows a removed notice and hides the directions and edit actions. A toilet whose
   * `active` is false is shown as removed without this.
   */
  removed?: boolean;
  /**
   * The viewer's changes go live straight away (signed in with an unexpired session): the
   * restore prompt then says it will be put back at once, and otherwise that a moderator will
   * check first.
   */
  canWriteDirectly?: boolean;
  /** The viewer's location, for the distance in the summary. */
  userLocation?: LatLng | null;
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
 * The toilet details panel. It always opens expanded: the summary (name, distance, open now,
 * key features, Directions and the Details toggle) with the rest (hours, facilities, the
 * verify / edit / report actions) below it. The Details toggle or the sheet's handle
 * collapses it to the summary alone, and expands it again.
 *
 * - Below 768px: a non-modal bottom sheet (expanded / peek). Expanded, it is capped at 70% of
 *   the map (less on a short map, so the selected marker always fits above it) and pins only
 *   a compact header (name, distance / open now, Details and Close); the key features,
 *   payment, notices and Directions scroll, first, with the details.
 * - From 768px, and on a phone in landscape (600px wide or more, at most 500px tall): a
 *   floating card on the left, under the search bar, scrolling inside.
 *
 * Close (the X) always closes. Escape inside the panel collapses the details first, then
 * closes; dragging the sheet's handle down does the same. Focus moves to the heading on open
 * and back to `returnFocusTo` (or the search box) on close.
 *
 * On short screens (a phone in landscape, at most 560px tall) the card scrolls as a whole, so
 * its summary, notices and actions can't be squeezed out of reach.
 *
 * Positions itself absolutely: render it directly inside the (positioned) map container.
 */
export default function ToiletDetailsPanel({
  toilet,
  onClose,
  apiUrl = "",
  notice,
  removed = false,
  canWriteDirectly = false,
  userLocation = null,
  returnFocusTo,
  onLayoutChange,
  cardTop,
}: ToiletDetailsPanelProps) {
  const mode = usePanelMode();
  const uid = useId();
  const titleId = `${uid}-title`;
  const detailsId = `${uid}-details`;
  // Every open starts expanded (marker tap, deep link, Back/Forward, another toilet: LooMap
  // keys the panel by toilet id, so each toilet mounts afresh). The first layout report is
  // therefore the expanded size, which LooMap pans the marker clear of.
  const [expanded, setExpanded] = useState(true);
  const panelState: PanelState = expanded ? "expanded" : "peek";

  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const detailsToggleRef = useRef<HTMLButtonElement>(null);
  /** Set when a state change should take focus to the Details toggle once it re-renders. */
  const focusToggleRef = useRef(false);
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

  /** The expanded sheet pins only a compact header; the rest of the summary scrolls. */
  const compactHeader = mode === "sheet" && expanded;

  useLayoutReporter(rootRef, mode, panelState, onLayoutChange);
  // The expanded sheet's header is sticky: its scroller pads its top by the header's height.
  useSummaryHeight(rootRef, summaryRef, compactHeader);

  // In the sheet the Details toggle moves between the pinned header (expanded) and the
  // summary's actions (collapsed): when it had focus, focus follows it to its new place.
  // A layout effect, so it happens with the re-render, not after the next paint: by then the
  // user may have moved focus on (into the search box), and it mustn't be pulled back.
  useLayoutEffect(() => {
    if (!focusToggleRef.current) return;
    focusToggleRef.current = false;
    detailsToggleRef.current?.focus({ preventScroll: true });
  }, [expanded]);

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
    if (restore.status === "done") restoreResultRef.current?.focus();
  }, [restore.status]);

  const setPanelState = (next: PanelState) => {
    const active = document.activeElement;
    // Focus inside the details would be lost when they unmount, and the toggle itself moves
    // in the sheet: keep focus on the toggle.
    const details = next === "peek" ? document.getElementById(detailsId) : null;
    if (
      (active && active === detailsToggleRef.current) ||
      (active && details?.contains(active)) ||
      // The scrolling top of the expanded sheet (Directions, notices) goes too.
      (next === "peek" && active?.closest(`.${styles.summaryExtras}`))
    ) {
      detailsToggleRef.current?.focus();
      focusToggleRef.current = true;
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

  /** The restore dialog's confirm: busy until the request settles, then closed. */
  const onRestore = async () => {
    if (restore.status === "sending") return;
    setRestore({ status: "sending" });
    const result = await restoreLoo(apiUrl, toilet.id, {
      details: canWriteDirectly ? undefined : restoreDetails,
      baseUpdatedAt: current.updatedAt,
    });
    if (result.kind === "applied") {
      setLocal({ base: toilet, value: { ...current, ...result.loo } });
    } else if (result.kind === "queued") {
      rememberPendingChange(toilet.id, "restore", result.pendingId);
      setPending(readPendingChange(toilet.id));
    }
    // Done (or nothing to do): close the dialog and say so in the panel. A failure keeps it
    // open with the error, so it can be tried again.
    if (result.kind === "applied" || result.kind === "queued" || result.kind === "notRemoved") {
      setRestoreOpen(false);
    }
    setRestore({ status: "done", outcome: result });
  };

  const openRestore = () => setRestoreOpen(true);

  const cancelRestore = () => {
    setRestoreOpen(false);
    setRestore({ status: "idle" });
    // The prompt's trigger comes back on the next render.
    requestAnimationFrame(() => restoreActionRef.current?.querySelector("button")?.focus());
  };

  const restoreSucceeded =
    restore.status === "done" &&
    (restore.outcome.kind === "applied" || restore.outcome.kind === "queued");

  const showPending =
    !!pending && !(restore.status === "done" && restore.outcome.kind === "queued");

  const restoreResult = (() => {
    if (restore.status !== "done") return null;
    const r = restore.outcome;
    const line = (tone: "success" | "info" | "warning" | "error", body: JSX.Element | string) => (
      <Notice tone={tone} size="compact" announce="off">
        {body}
      </Notice>
    );
    switch (r.kind) {
      case "applied":
        return line("success", RESTORED_MESSAGE);
      case "queued":
        return line("success", RESTORE_QUEUED_MESSAGE);
      case "notRemoved":
        return line("info", "It's already back on the map.");
      case "conflict":
        return line(
          "warning",
          <>
            Someone else changed this toilet since you opened it.{" "}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>{" "}
            to see the latest version.
          </>,
        );
      case "notFound":
        return line("error", "We couldn't find this toilet — it may have been deleted.");
      case "auth":
        return line(
          "error",
          <>
            Your sign-in has expired.{" "}
            <a href={`/auth/login?returnTo=${encodeURIComponent(`${looHref}?restore=1`)}`}>
              Sign in again
            </a>{" "}
            to restore it.
          </>,
        );
      case "rateLimited":
        return line(
          "error",
          "You've sent a lot of requests in a short time. Please try again later.",
        );
      case "error":
        return line("error", r.message);
      default:
        return null;
    }
  })();

  /** The result in the panel once the dialog has closed; while it is open, in the dialog. */
  const panelRestoreResult = restoreOpen ? null : restoreResult;

  const notices =
    notice || isRemoved || showPending || panelRestoreResult ? (
      <div className={styles.notices}>
        {isRemoved && (
          <Notice tone="warning" size="compact">
            <p>{summary ?? `${REMOVED_MESSAGE}.`}</p>
            {duplicateOf && (
              <p>
                <a href={`/loos/${encodeURIComponent(duplicateOf)}`}>
                  See the toilet it duplicates
                </a>
              </p>
            )}
          </Notice>
        )}
        {panelRestoreResult && (
          // The focus target after a restore, and the live region that announces its result.
          <div ref={restoreResultRef} tabIndex={-1} role="status" className={styles.focusTarget}>
            {panelRestoreResult}
          </div>
        )}
        {showPending && (
          <Notice tone="info" size="compact">
            {PENDING_MESSAGE}
          </Notice>
        )}
        {notice && (
          // The map's own copy is the live region; this one is only shown.
          <div aria-hidden="true">
            <Notice tone="warning" size="compact" announce="off">
              {notice}
            </Notice>
          </div>
        )}
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

  const restoreName = current.name?.trim() || "this toilet";
  const restoreDialog = canRestore ? (
    <ConfirmDialog
      open={restoreOpen}
      class={styles.panel}
      title="Is it still here?"
      initialFocus="title"
      confirmLabel="Restore it"
      busyLabel="Sending…"
      onConfirm={onRestore}
      onCancel={cancelRestore}
      extra={
        <>
          {restoreResult && (
            <div role="alert" className={styles.restoreField}>
              {restoreResult}
            </div>
          )}
          {/* A signed-in user's restore is applied straight away and the server ignores its
              details. Known trade-off: a blocked user (or a session that expired after render)
              looks signed in here, so their restore is queued with no note; the server's 202
              still shows the queued message. */}
          {!canWriteDirectly && (
            <div className={styles.restoreField}>
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
            </div>
          )}
        </>
      }
    >
      <p className={styles.restoreText}>
        {canWriteDirectly
          ? `If ${restoreName} is still here and open to the public, it will go back on the map straight away.`
          : `If ${restoreName} is still here and open to the public, tell us and a moderator will check before it goes back on the map.`}
      </p>
    </ConfirmDialog>
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
      compact={compactHeader}
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
        {restoreDialog}
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
      {restoreDialog}
    </section>
  );
}
