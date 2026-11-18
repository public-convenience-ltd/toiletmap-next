import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Icon, Notice } from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import {
  type ChangeOutcome,
  fetchNearbyLoos,
  formatDistance,
  MAX_DETAILS_LENGTH,
  type NearbyLoo,
  type ReportReason,
  rememberPendingChange,
  reportLoo,
  restoreLoo,
} from "../../api/reports";
import { compassDirection } from "../ReviewChanges/describeChanges";
import styles from "./ReportProblem.module.css";

/**
 * A choice on step 1. `temporarily_closed` and `wrong_place` aren't reports: the toilet stays on
 * the map, and they point at the edit form instead.
 */
export type ReportChoice = ReportReason | "temporarily_closed" | "wrong_place";

type FixInstead = "temporarily_closed" | "wrong_place";

/** Choices answered by editing the toilet rather than reporting it. */
const isFixInstead = (choice: ReportChoice | null): choice is FixInstead =>
  choice === "temporarily_closed" || choice === "wrong_place";

interface ChoiceDef {
  value: ReportChoice;
  label: string;
}

export const REPORT_CHOICES: readonly ChoiceDef[] = [
  { value: "permanently_closed", label: "It's permanently closed or demolished" },
  { value: "wrong_place", label: "It's in the wrong place on the map" },
  { value: "does_not_exist", label: "It doesn't exist" },
  { value: "temporarily_closed", label: "It's temporarily closed" },
  { value: "not_public", label: "It's not open to the public (customers only)" },
  { value: "duplicate", label: "It's a duplicate of another toilet" },
  { value: "other", label: "Something else" },
];

const choiceLabel = (choice: ReportChoice) =>
  REPORT_CHOICES.find((c) => c.value === choice)?.label ?? choice;

/** Radius searched for the toilet this one duplicates, in metres. */
export const DUPLICATE_RADIUS = 100;

export interface ReportProblemProps {
  loo: LooDetail;
  apiUrl: string;
  isAuthenticated: boolean;
  /**
   * The user's reports go live straight away (signed in with an unexpired session), so the
   * confirm step says it will be removed at once. Only used for the copy: the server decides,
   * and a blocked user's report is queued and shown as such.
   */
  canWriteDirectly?: boolean;
}

type Step = "choose" | "confirm" | "result";

type NearbyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; items: NearbyLoo[] };

/** The check step's button for a report a moderator checks first. */
export const REPORT_LABEL = "Report it";
/** …and for one that removes the toilet straight away (any signed-in user). */
export const REMOVE_LABEL = "Remove it from the map";

/** Where the error summary's links point. */
const ERROR_ANCHORS = {
  choice: "report-choice",
  duplicate: "report-duplicate",
  details: "report-details",
} as const;

/** The error summary's order: the order of the fields on the page. */
const ERROR_ORDER = ["choice", "duplicate", "details"] as const;

interface Errors {
  choice?: string;
  duplicate?: string;
  details?: string;
}

type UndoState = { status: "idle" | "sending" } | { status: "done"; outcome: ChangeOutcome };

const signInHref = (path: string) => `/auth/login?returnTo=${encodeURIComponent(path)}`;

const currentPath = () =>
  typeof window === "undefined"
    ? "/"
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Focus an element once it is on screen (after the render that mounts it). */
function useFocusOnChange(key: unknown) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
  }, [key]);
  return ref;
}

/** "23 m away" or, when both locations are known, "23 m north". */
function describeNearby(from: LooDetail["location"], item: NearbyLoo): string {
  const distance = formatDistance(item.distance);
  if (!from || !item.location || !distance || item.distance < 1) return distance;
  return `${distance.replace(/ away$/, "")} ${compassDirection(from, item.location)}`;
}

export default function ReportProblem({
  loo,
  apiUrl,
  isAuthenticated,
  canWriteDirectly = false,
}: ReportProblemProps) {
  const trusted = isAuthenticated && canWriteDirectly;
  /** The check step's button says what it does: a trusted report removes the toilet at once. */
  const submitLabel = trusted ? REMOVE_LABEL : REPORT_LABEL;
  const name = loo.name?.trim() || "this toilet";
  /** `name` for the start of a sentence. */
  const Name = loo.name?.trim() || "This toilet";
  const looHref = `/loos/${encodeURIComponent(loo.id)}`;
  const editHref = `${looHref}/edit`;

  const [step, setStep] = useState<Step>("choose");
  const [choice, setChoice] = useState<ReportChoice | null>(null);
  const [details, setDetails] = useState("");
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyState>({ status: "idle" });
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ChangeOutcome | null>(null);
  const [outcome, setOutcome] = useState<ChangeOutcome | null>(null);
  const [undo, setUndo] = useState<UndoState>({ status: "idle" });

  const headingRef = useFocusOnChange(step);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const choiceRef = useRef<HTMLInputElement>(null);
  const duplicateRef = useRef<HTMLFieldSetElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const undoResultRef = useRef<HTMLDivElement>(null);

  const location = loo.location;

  const loadNearby = async () => {
    if (!location) return;
    setNearby({ status: "loading" });
    try {
      const items = await fetchNearbyLoos(apiUrl, location, {
        radius: DUPLICATE_RADIUS,
        excludeId: loo.id,
      });
      setNearby({ status: "loaded", items });
    } catch (error) {
      console.error("Couldn't load nearby toilets:", error);
      setNearby({ status: "error" });
    }
  };

  useEffect(() => {
    if (choice === "duplicate" && nearby.status === "idle") loadNearby();
  }, [choice]);

  useEffect(() => {
    if (submitError) submitErrorRef.current?.focus();
  }, [submitError]);

  useEffect(() => {
    if (undo.status === "done") undoResultRef.current?.focus();
  }, [undo.status]);

  const nearbyItems = nearby.status === "loaded" ? nearby.items : [];
  const duplicateLoo = nearbyItems.find((item) => item.id === duplicateOf) ?? null;

  const selectChoice = (value: ReportChoice) => {
    setChoice(value);
    setErrors({});
  };

  const validate = (): boolean => {
    const next: Errors = {};
    const trimmed = details.trim();
    if (!choice) next.choice = "Choose what's wrong with this toilet.";
    if (choice === "duplicate" && !duplicateOf) {
      next.duplicate = "Choose the toilet this one duplicates.";
    }
    if (choice === "other" && !trimmed) next.details = "Tell us what's wrong.";
    if (trimmed.length > MAX_DETAILS_LENGTH) {
      next.details = `Keep the details to ${MAX_DETAILS_LENGTH} characters or fewer.`;
    }
    setErrors(next);
    const first = ERROR_ORDER.find((key) => next[key]);
    if (first) focusError(first);
    return Object.keys(next).length === 0;
  };

  /** Puts focus on the field an error is about (validation, and the error summary's links). */
  const focusError = (key: keyof Errors) => {
    if (key === "choice") choiceRef.current?.focus();
    else if (key === "duplicate") {
      duplicateRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    } else detailsRef.current?.focus();
  };

  const onContinue = (event: Event) => {
    event.preventDefault();
    if (isFixInstead(choice)) return;
    if (!validate()) return;
    setSubmitError(null);
    setStep("confirm");
  };

  const onSubmit = async () => {
    if (!choice || isFixInstead(choice) || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await reportLoo(apiUrl, loo.id, {
      reason: choice,
      details,
      duplicateOf: duplicateOf ?? undefined,
      baseUpdatedAt: loo.updatedAt,
    });
    setSubmitting(false);
    if (result.kind === "error" || result.kind === "rateLimited" || result.kind === "auth") {
      setSubmitError(result);
      return;
    }
    if (result.kind === "queued") rememberPendingChange(loo.id, "remove", result.pendingId);
    setOutcome(result);
    setStep("result");
  };

  const onUndo = async () => {
    if (outcome?.kind !== "applied" || undo.status === "sending") return;
    setUndo({ status: "sending" });
    const result = await restoreLoo(apiUrl, loo.id, {
      details: "Undone straight after reporting it by mistake.",
      baseUpdatedAt: outcome.loo.updatedAt,
    });
    if (result.kind === "queued") rememberPendingChange(loo.id, "restore", result.pendingId);
    setUndo({ status: "done", outcome: result });
  };

  // ── Already removed (on page load) ────────────────────────────────────────
  if (loo.active === false && step === "choose") {
    return (
      <section className={styles.container} aria-labelledby="report-heading">
        <h1 id="report-heading" className={styles.title}>
          {Name} has already been removed from the map
        </h1>
        <p>Nobody needs to report it again.</p>
        <div className={styles.actions}>
          {/* Matches the toilet page's restore button: signed-in users restore it themselves. */}
          <Button htmlElement="a" variant="primary" href={`${looHref}?restore=1`}>
            {trusted ? "It's still here — restore it" : "It's still here — ask to restore it"}
          </Button>
          <Button htmlElement="a" variant="secondary" href="/">
            Back to map
          </Button>
        </div>
      </section>
    );
  }

  // ── Step 3: result ────────────────────────────────────────────────────────
  if (step === "result" && outcome) {
    return (
      <section className={styles.container} aria-labelledby="report-heading">
        {renderResult()}
      </section>
    );
  }

  function resultHeading(text: ComponentChildren) {
    return (
      <h1 id="report-heading" className={styles.title} tabIndex={-1} ref={headingRef}>
        {text}
      </h1>
    );
  }

  function renderUndoResult() {
    if (undo.status !== "done") return null;
    const r = undo.outcome;
    let message: ComponentChildren;
    let variant: "success" | "error" = "success";
    if (r.kind === "applied" || r.kind === "notRemoved") {
      message = (
        <>
          {Name} is back on the map. <a href={looHref}>View the toilet</a>
        </>
      );
    } else if (r.kind === "queued") {
      message = "A moderator will review your request to put it back.";
    } else {
      variant = "error";
      message =
        r.kind === "error"
          ? r.message
          : "We couldn't undo that. Open the toilet and choose “It's still here” to restore it.";
    }
    return (
      <div ref={undoResultRef} tabIndex={-1} role="status" className={styles.undoResult}>
        <Notice tone={variant} announce="off">
          {message}
        </Notice>
      </div>
    );
  }

  function renderResult() {
    if (!outcome) return null;
    switch (outcome.kind) {
      case "applied": {
        const undoKind = undo.status === "done" ? undo.outcome.kind : null;
        const undone = undoKind === "applied" || undoKind === "queued" || undoKind === "notRemoved";
        // The heading always says where things stand now, so it never contradicts the
        // undo result below it.
        const heading =
          undoKind === "queued"
            ? "Undo requested"
            : undone
              ? "Undone — it's back on the map"
              : "Removed — thanks.";
        // The outcome pattern (shared with the edit form): a heading, a Notice saying where
        // things stand, then the next step as the primary button, first.
        return (
          <>
            {resultHeading(heading)}
            {!undone && (
              <div className={styles.outcomeNotice}>
                <Notice tone="success" announce="off">
                  {Name} is no longer on the map.
                </Notice>
              </div>
            )}
            {renderUndoResult()}
            <div className={styles.actions}>
              <Button htmlElement="a" variant="primary" href="/">
                Back to map
              </Button>
              {!undone && (
                <Button
                  htmlElement="button"
                  type="button"
                  variant="secondary"
                  onClick={onUndo}
                  disabled={undo.status === "sending"}
                >
                  {undo.status === "sending" ? "Undoing…" : "Undo"}
                </Button>
              )}
            </div>
          </>
        );
      }
      case "queued":
        return (
          <>
            {resultHeading("Thanks — a moderator will review your report")}
            <div className={styles.outcomeNotice}>
              <Notice tone="success" announce="off">
                {Name} stays on the map until they've checked it.
              </Notice>
            </div>
            <div className={styles.actions}>
              <Button htmlElement="a" variant="primary" href={looHref}>
                Back to the toilet
              </Button>
              <Button htmlElement="a" variant="secondary" href="/">
                Back to map
              </Button>
            </div>
            {!isAuthenticated && (
              <p className={styles.signInPrompt}>
                <a href={signInHref(currentPath())}>Sign in</a> to keep track of your contributions.
              </p>
            )}
          </>
        );
      case "alreadyRemoved":
        return (
          <>
            {resultHeading("It's already been removed")}
            <div className={styles.outcomeNotice}>
              <Notice tone="info" announce="off">
                Someone has already removed {name} from the map, so there's nothing more to do.
              </Notice>
            </div>
            <div className={styles.actions}>
              <Button htmlElement="a" variant="primary" href="/">
                Back to map
              </Button>
            </div>
          </>
        );
      case "conflict":
        return (
          <>
            {resultHeading("This toilet has just been changed")}
            <div className={styles.outcomeNotice}>
              <Notice tone="warning" announce="off">
                Someone else updated {name} since you opened this page. Reload to check the latest
                details, then report it again if it's still wrong.
              </Notice>
            </div>
            <div className={styles.actions}>
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={() => window.location.reload()}
              >
                Reload page
              </Button>
            </div>
          </>
        );
      case "notFound":
        return (
          <>
            {resultHeading("We couldn't find this toilet")}
            <div className={styles.outcomeNotice}>
              <Notice tone="error" announce="off">
                It may already have been deleted.
              </Notice>
            </div>
            <div className={styles.actions}>
              <Button htmlElement="a" variant="primary" href="/">
                Back to map
              </Button>
            </div>
          </>
        );
      default:
        return null;
    }
  }

  // ── Step 2: confirm ───────────────────────────────────────────────────────
  if (step === "confirm" && choice && !isFixInstead(choice)) {
    const trimmed = details.trim();
    return (
      <section className={styles.container} aria-labelledby="report-heading">
        {resultHeading("Check your report")}
        <dl className={styles.summary}>
          <div>
            <dt>Toilet</dt>
            <dd>{loo.name?.trim() || "Unnamed toilet"}</dd>
          </div>
          <div>
            <dt>Problem</dt>
            <dd>{choiceLabel(choice)}</dd>
          </div>
          {choice === "duplicate" && (
            <div>
              <dt>Duplicate of</dt>
              <dd>
                {duplicateLoo?.name ?? "Unnamed toilet"}
                {duplicateLoo && describeNearby(location, duplicateLoo) && (
                  <span className={styles.cardMeta}>
                    {" "}
                    ({describeNearby(location, duplicateLoo)})
                  </span>
                )}
              </dd>
            </div>
          )}
          {trimmed && (
            <div>
              <dt>Details</dt>
              <dd className={styles.detailsText}>{trimmed}</dd>
            </div>
          )}
        </dl>
        <div className={styles.consequence}>
          {/* What the button will do: a warning when it removes the toilet at once. */}
          <Notice tone={trusted ? "warning" : "info"} announce="off">
            {trusted
              ? `${Name} will be removed from the map straight away. You can undo this on the next screen.`
              : `A moderator will check your report before ${name} is removed from the map.`}
          </Notice>
        </div>
        {submitError && (
          <div ref={submitErrorRef} tabIndex={-1} className={styles.submitError}>
            <Notice tone="error">{renderSubmitError(submitError)}</Notice>
          </div>
        )}
        {/* Primary first, as on every outcome screen and the form's own Continue. */}
        <div className={styles.actions}>
          <Button
            htmlElement="button"
            type="button"
            // Removing a toilet at once is destructive (even with Undo), and says so; a report
            // a moderator checks first is not.
            variant={trusted ? "destructive" : "primary"}
            onClick={onSubmit}
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? (trusted ? "Removing…" : "Sending…") : submitLabel}
          </Button>
          <Button
            htmlElement="button"
            type="button"
            variant="secondary"
            onClick={() => setStep("choose")}
            disabled={submitting}
          >
            Back
          </Button>
        </div>
      </section>
    );
  }

  function renderSubmitError(error: ChangeOutcome) {
    if (error.kind === "auth") {
      return (
        <>
          Your sign-in has expired. <a href={signInHref(currentPath())}>Sign in again</a> to send
          your report.
        </>
      );
    }
    if (error.kind === "rateLimited") {
      return "You've sent a lot of reports in a short time. Please wait a few minutes and try again.";
    }
    if (error.kind === "error") {
      return (
        <>
          {error.message}
          {error.details && (
            <ul>
              {error.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      );
    }
    return null;
  }

  // ── Step 1: choose ────────────────────────────────────────────────────────
  const detailsRequired = choice === "other";
  const detailsLabel = detailsRequired
    ? "What's wrong?"
    : "Anything else we should know? (optional)";
  const detailsHintId = "report-details-hint";
  const detailsErrorId = "report-details-error";

  return (
    <section className={styles.container} aria-labelledby="report-heading">
      <h1 id="report-heading" className={styles.title} tabIndex={-1} ref={headingRef}>
        Report a problem with {loo.name?.trim() || "this toilet"}
      </h1>
      {ERROR_ORDER.some((key) => errors[key]) && (
        // The same summary as the add and edit forms: every problem, each linked to its field.
        <div className={styles.errorSummary}>
          <Notice tone="error" title="There's a problem" headingLevel={2}>
            <ul className={styles.errorList}>
              {ERROR_ORDER.filter((key) => errors[key]).map((key) => (
                <li key={key}>
                  <a
                    href={`#${ERROR_ANCHORS[key]}`}
                    onClick={(e) => {
                      e.preventDefault();
                      focusError(key);
                    }}
                  >
                    {errors[key]}
                  </a>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      <form onSubmit={onContinue} noValidate>
        <fieldset
          id={ERROR_ANCHORS.choice}
          className={styles.fieldset}
          aria-describedby={errors.choice ? "report-choice-error" : undefined}
        >
          <legend className={styles.legend}>What's wrong with this toilet?</legend>
          {errors.choice && (
            <p id="report-choice-error" className={styles.error}>
              {errors.choice}
            </p>
          )}
          <div className={styles.cards}>
            {REPORT_CHOICES.map((c, index) => (
              <label
                key={c.value}
                className={`${styles.card}${choice === c.value ? ` ${styles.cardSelected}` : ""}`}
              >
                <input
                  type="radio"
                  name="reason"
                  value={c.value}
                  checked={choice === c.value}
                  onChange={() => selectChoice(c.value)}
                  ref={index === 0 ? choiceRef : undefined}
                  className={styles.radio}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {choice === "wrong_place" && (
          <div className={styles.explain}>
            <p>
              If the toilet is there but its pin is in the wrong place, it stays on the map: move
              the pin to where the toilet really is.
            </p>
            <div className={styles.actions}>
              <Button htmlElement="a" variant="primary" href={`${editHref}#location`}>
                <Icon icon="map-location-dot" size="small" />
                Move the pin
              </Button>
            </div>
          </div>
        )}

        {choice === "temporarily_closed" && (
          <div className={styles.explain}>
            <p>
              Temporarily closed toilets stay on the map. Update the opening hours, or add a note
              (for example “Closed for repairs until March”), so other people know before they set
              off.
            </p>
            <div className={styles.actions}>
              <Button htmlElement="a" variant="primary" href={`${editHref}#hours`}>
                <Icon icon="clock" size="small" />
                Update opening hours or notes
              </Button>
            </div>
          </div>
        )}

        {choice === "not_public" && (
          <p className={styles.explain}>
            If it's for customers only (for example in a café or shop), it can stay on the map:{" "}
            <a href={`${editHref}#notes`}>add a note</a> so people know to ask. If there's no public
            access at all, continue to report it.
          </p>
        )}

        {choice === "duplicate" && (
          <fieldset
            id={ERROR_ANCHORS.duplicate}
            className={styles.fieldset}
            ref={duplicateRef}
            aria-describedby={errors.duplicate ? "report-duplicate-error" : undefined}
          >
            <legend className={styles.subLegend}>Which toilet is it a duplicate of?</legend>
            {errors.duplicate && (
              <p id="report-duplicate-error" className={styles.error}>
                {errors.duplicate}
              </p>
            )}
            {renderNearby()}
          </fieldset>
        )}

        {choice && !isFixInstead(choice) && (
          <div className={styles.field}>
            <label htmlFor="report-details" className={styles.label}>
              {detailsLabel}
            </label>
            <p id={detailsHintId} className={styles.hint}>
              {detailsRequired
                ? "Describe the problem so a moderator can check it."
                : "For example when it closed, or what's there now."}
            </p>
            {errors.details && (
              <p id={detailsErrorId} className={styles.error}>
                {errors.details}
              </p>
            )}
            <textarea
              id="report-details"
              ref={detailsRef}
              className={`text-area ${styles.textarea}`}
              value={details}
              rows={4}
              maxLength={MAX_DETAILS_LENGTH}
              required={detailsRequired}
              aria-required={detailsRequired || undefined}
              aria-invalid={errors.details ? true : undefined}
              aria-describedby={`${detailsHintId}${errors.details ? ` ${detailsErrorId}` : ""}`}
              onInput={(e) => setDetails((e.currentTarget as HTMLTextAreaElement).value)}
            />
          </div>
        )}

        <div className={styles.actions}>
          {!isFixInstead(choice) && (
            <Button htmlElement="button" type="submit" variant="primary">
              Continue
            </Button>
          )}
          <Button htmlElement="a" variant="secondary" href={looHref}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );

  function renderNearby() {
    if (!location) {
      return (
        <p className={styles.hint}>
          This toilet has no location, so we can't look for nearby toilets. Choose “Something else”
          and tell us which toilet it duplicates.
        </p>
      );
    }
    if (nearby.status === "loading" || nearby.status === "idle") {
      return (
        <p role="status" className={styles.hint}>
          Looking for nearby toilets…
        </p>
      );
    }
    if (nearby.status === "error") {
      return (
        <Notice
          tone="error"
          size="compact"
          action={{ label: "Try again", onClick: () => loadNearby() }}
        >
          We couldn't load nearby toilets.
        </Notice>
      );
    }
    if (nearby.items.length === 0) {
      return (
        <p className={styles.hint}>
          There are no other toilets within {DUPLICATE_RADIUS} m. If the duplicate is further away,
          choose “Something else” and tell us which one it is.
        </p>
      );
    }
    return (
      <div className={styles.cards}>
        {nearby.items.map((item) => (
          <div
            key={item.id}
            className={`${styles.card} ${styles.cardWithLink}${duplicateOf === item.id ? ` ${styles.cardSelected}` : ""}`}
          >
            <label className={styles.cardLabel}>
              <input
                type="radio"
                name="duplicateOf"
                value={item.id}
                checked={duplicateOf === item.id}
                onChange={() => {
                  setDuplicateOf(item.id);
                  setErrors((prev) => ({ ...prev, duplicate: undefined }));
                }}
                className={styles.radio}
              />
              <span className={styles.cardText}>
                <span>{item.name ?? "Unnamed toilet"}</span>
                <span className={styles.cardMeta}>{describeNearby(location, item)}</span>
              </span>
            </label>
            {/* Outside the label, so following the link never changes the choice. */}
            <a
              className={styles.cardLink}
              href={`/loos/${encodeURIComponent(item.id)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View
              <span className={styles.srOnly}>
                {" "}
                {item.name ?? "unnamed toilet"} (opens in a new tab)
              </span>
            </a>
          </div>
        ))}
      </div>
    );
  }
}
