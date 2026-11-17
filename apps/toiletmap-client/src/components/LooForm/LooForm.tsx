import "leaflet/dist/leaflet.css";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Banner,
  Button,
  InputField,
  OpeningHoursInput,
  TextArea,
  TriStateToggle,
  type TriStateValue,
  validateOpeningTimes,
} from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import { applyLocalMutation } from "../../api/mapCache";
import { readPendingChange, rememberPendingChange } from "../../api/reports";
import { currentPath, loginHref } from "../../utils/returnTo";
import { type MapView, mapViewFromSearch } from "../LooMap/mapView";
import Dialog from "../ReviewChanges/Dialog";
import { describeChanges } from "../ReviewChanges/describeChanges";
import ReviewChanges from "../ReviewChanges/ReviewChanges";
import {
  applyDraft,
  clearDraft,
  draftKey,
  draftWithUnresolvedConflicts,
  loadDraft,
  saveDraft,
  type UnresolvedDraftConflicts,
} from "./draft";
import { distanceMeters, isValidLatLng } from "./geometry";
import { fieldErrorsFromIssues } from "./issues";
import LocationPicker from "./LocationPicker";
import styles from "./LooForm.module.css";
import {
  buildLooPatch,
  changedFormFields,
  conflictingFields,
  FIELD_LABELS,
  formStateFromLoo,
  type LooFormField,
  type LooFormMode,
  type LooFormState,
  rebaseOnCurrent,
  type TriStateField,
} from "./payload";
import { interpretSaveResponse } from "./saveResponse";

export interface LooFormProps {
  mode: LooFormMode;
  initialData?: LooDetail | null;
  looId?: string;
  /** API origin. "" means same-origin relative URLs (the client worker proxies /api/*). */
  apiUrl: string;
  isAuthenticated: boolean;
  /**
   * The user is signed in with an unexpired session, so their saves go live straight away
   * (anonymous suggestions are checked by a moderator). Only used for the copy: the server
   * decides, and queues a blocked user's save, which then shows the queued screen.
   */
  canWriteDirectly?: boolean;
  /** Where the add picker opens (from `?lat&lng&zoom`). The picker falls back to the URL itself. */
  initialView?: MapView | null;
  /**
   * Save straight away instead of showing the "Check your changes" sheet. Only honoured for
   * signed-in users: anonymous suggestions are always reviewed first.
   */
  skipReview?: boolean;
}

type FormErrors = Partial<Record<LooFormField, string>>;

type SubmitError =
  | { kind: "message"; message: string; details?: string[] }
  | { kind: "auth" }
  | { kind: "notFound" }
  | { kind: "conflict"; current: LooDetail; fields: LooFormField[] };

type Outcome = "queued" | "unchanged";

const CONFLICT_MESSAGE = "This toilet was changed by someone else while you were editing.";

export const MESSAGES = {
  nameRequired: "Enter a name for the toilet.",
  locationRequired: "Show where the toilet is on the map.",
  locationInvalid: "The location isn't valid. Move the pin again.",
  locationUnconfirmed:
    "Confirm the toilet's location with “Use this location”, or cancel the move.",
  /** A new toilet whose pin hasn't been placed yet: there is no move to cancel. */
  locationNotPlaced:
    "Move the map until the pin is on the toilet, then choose “Use this location”.",
} as const;

export const LIVE_STRAIGHT_AWAY = "Your change will go live straight away.";
export const MODERATOR_WILL_CHECK = "A moderator will check your change before it appears.";

/**
 * Two `?lat&lng` spots (or a pin and a spot) closer than this are the same place: a restored
 * add-form pin is only dropped for a page opened at a different spot from the draft's.
 */
const REQUESTED_VIEW_TOLERANCE_METERS = 1;

/** Form fields in the order the questions are asked (and errors are listed). */
const FIELD_ORDER: LooFormField[] = [
  "name",
  "location",
  "women",
  "men",
  "allGender",
  "children",
  "urinalOnly",
  "babyChange",
  "accessible",
  "radar",
  "noPayment",
  "paymentDetails",
  "openingTimes",
  "notes",
  "automatic",
];

/**
 * Deep links into the form (used by "Report a problem" and the details panel), and the field
 * each one focuses: `/loos/:id/edit#hours`, `#notes`, `#location`.
 */
export const SECTION_ANCHORS = {
  location: "location",
  hours: "openingTimes",
  notes: "notes",
} as const satisfies Record<string, LooFormField>;

/** The element the error summary links to for each field. */
export const fieldId = (field: LooFormField): string => `field-${field}`;

/** The map row [id, geohash, filterMask] a 200/201 save returns as `compressed`. */
type CompressedRow = [string, string, number];

/**
 * Read `compressed` from a save response: a row, null (the toilet is inactive, so it leaves
 * the map), or undefined when absent/malformed (then the cache is left for the next delta,
 * rather than deleting a toilet that is still on the map).
 */
const compressedFromSaveBody = (body: unknown, id: string): CompressedRow | null | undefined => {
  if (!body || typeof body !== "object" || !("compressed" in body)) return undefined;
  const value = (body as { compressed: unknown }).compressed;
  if (value === null) return null;
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === id &&
    typeof value[1] === "string" &&
    typeof value[2] === "number"
  ) {
    return value as CompressedRow;
  }
  return undefined;
};

/**
 * Read-your-writes after a successful save: patch the map cache (IndexedDB, so it survives
 * the full navigation to the toilet's page) and mark the row with the save's `updatedAt`
 * so an in-flight delta read before the save can't undo it. Best effort: the save itself
 * has succeeded, and the next delta re-delivers the change anyway (its cursor overlaps).
 *
 * The detail itself is not cached here: the redirect is a full page load, which resets the
 * in-memory detail cache, and the toilet page's own fetch returns the saved version.
 */
const applySavedLocally = async (body: LooDetail) => {
  const compressed = compressedFromSaveBody(body, body.id);
  if (compressed === undefined) return;
  const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt : null;
  try {
    await applyLocalMutation(body.id, compressed, updatedAt);
  } catch (error) {
    console.error("Couldn't update the cached map data:", error);
  }
};

/**
 * Focus a field from the error summary: the control a widget marks as its first invalid one
 * (`data-first-invalid-for`, e.g. the opening-hours time input, which sits outside the group
 * carrying the id), else the invalid control inside the field, else the button the message
 * refers to (the picker's “Use this location”), else the element itself or the first control
 * inside it.
 */
const focusField = (id: string, scroll = true) => {
  const target = document.getElementById(id);
  if (!target) return;
  const invalid =
    document.querySelector<HTMLElement>(
      `[data-first-invalid-for="${CSS.escape(id)}"]:not([disabled])`,
    ) ?? target.querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled])');
  const confirm = target.querySelector<HTMLElement>('[data-focus="confirm"]:not([disabled])');
  const focusable =
    invalid ??
    confirm ??
    (target.matches("input, textarea, select, button, [tabindex]")
      ? target
      : target.querySelector<HTMLElement>(
          "input:not([disabled]), textarea, select, button:not([disabled]), [tabindex]",
        ));
  (focusable ?? target).focus(scroll ? undefined : { preventScroll: true });
  if (scroll) target.scrollIntoView?.({ block: "center" });
};

const formatSuggestedOn = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "recently"
    : `on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
};

interface QuestionProps {
  number: number;
  id: string;
  /** Deep-link target, e.g. `/loos/:id/edit#hours`. */
  anchor?: string;
  title: string;
  /** Make the title the label of this control (single-question cards). */
  titleFor?: string;
  hint?: string;
  children: ComponentChildren;
}

function Question({ number, id, anchor, title, titleFor, hint, children }: QuestionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={anchor} class={styles.card} aria-labelledby={titleId}>
      <h2 class={styles.cardTitle} id={titleId}>
        <span class={styles.cardNumber} aria-hidden="true">
          {number}
        </span>
        {titleFor ? <label for={titleFor}>{title}</label> : <span>{title}</span>}
      </h2>
      {hint && (
        <p class={styles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
    </section>
  );
}

export default function LooForm({
  mode,
  initialData,
  looId,
  apiUrl,
  isAuthenticated,
  canWriteDirectly = false,
  initialView,
  skipReview = false,
}: LooFormProps) {
  const storageKey = draftKey(mode === "edit" ? looId : null);
  const trusted = isAuthenticated && canWriteDirectly;

  // Restore an unsaved draft from this tab (if any) on top of the record as it is now.
  const [start] = useState(() => {
    const initial = initialData ?? null;
    const initialForm = formStateFromLoo(initial, mode);
    const draft = loadDraft(storageKey);
    // A new toilet opened at an explicit spot (`?lat&lng`, e.g. "Add as a new toilet instead"
    // or a long-press on the map) goes there, not to an old draft's pin — unless the draft was
    // started from that same spot (e.g. coming back from signing in), when the pin is the user's.
    const requested =
      mode === "add"
        ? (initialView ??
          (typeof window === "undefined" ? null : mapViewFromSearch(window.location.search ?? "")))
        : null;
    const pin = draft?.form.location;
    const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
      distanceMeters(a, b) <= REQUESTED_VIEW_TOLERANCE_METERS;
    const sameRequest =
      !!requested && !!draft?.requestedView && near(draft.requestedView, requested);
    const skip =
      requested && pin && !near(pin, requested) && !sameRequest
        ? (["location"] as LooFormField[])
        : [];
    const restored = draft
      ? applyDraft(draft, initialForm, {
          currentUpdatedAt: typeof initial?.updatedAt === "string" ? initial.updatedAt : null,
          skip,
        })
      : null;
    if (draft && !restored) clearDraft(storageKey);
    return {
      initial,
      initialForm,
      // A separate copy, so editing the form can never mutate the baseline.
      form: restored?.form ?? formStateFromLoo(initial, mode),
      restored: restored !== null,
      conflicts: restored?.conflicts ?? [],
      draftValues: restored?.draftValues ?? {},
      draftBase:
        restored && draft ? { form: draft.initialForm, updatedAt: draft.baseUpdatedAt } : null,
      pinSkipped: restored?.skipped.includes("location") ?? false,
      // Kept in the draft: the page's own `?lat&lng`, else the one the restored draft began at.
      requestedView: requested
        ? { lat: requested.lat, lng: requested.lng }
        : restored
          ? (draft?.requestedView ?? null)
          : null,
    };
  });

  // Baseline the user is editing against. Replaced when rebasing after a conflict.
  const [base, setBase] = useState({ initial: start.initial, initialForm: start.initialForm });
  const [form, setForm] = useState<LooFormState>(start.form);
  const [draftRestored, setDraftRestored] = useState(start.restored);
  /** Restored-draft fields someone else changed since: their value is shown, the user's kept here. */
  const [draftConflicts, setDraftConflicts] = useState<UnresolvedDraftConflicts | null>(
    start.conflicts.length > 0 && start.draftBase
      ? {
          fields: start.conflicts,
          values: start.draftValues,
          baseForm: start.draftBase.form,
          baseUpdatedAt: start.draftBase.updatedAt,
        }
      : null,
  );
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  /** Set once a save succeeded and the page is navigating away. */
  const [leaving, setLeaving] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  /** Terminal outcome that replaces the form: queued for moderation, or nothing needed changing. */
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  /** The discard dialog is open, and where "Discard changes" goes. */
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  /** The picker is in "move pin" mode with a location that hasn't been confirmed yet. */
  const [pinMoving, setPinMoving] = useState(false);
  // Remounts the controlled opening-hours widget when the baseline is replaced.
  const [baseVersion, setBaseVersion] = useState(0);
  const [pendingSuggestion] = useState(() =>
    mode === "edit" && looId ? readPendingChange(looId) : null,
  );

  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  /** Navigation we started on purpose (save, discard, sign in): don't warn about it. */
  const allowUnloadRef = useRef(false);

  const { payload, changedKeys } = useMemo(
    () => buildLooPatch({ initial: base.initial, initialForm: base.initialForm, form, mode }),
    [base, form, mode],
  );
  const changedFields = useMemo(
    () => changedFormFields(base.initialForm, form),
    [base.initialForm, form],
  );
  const dirty = changedFields.length > 0;
  const changeCount = changedKeys.length;
  const canSave = mode === "add" ? dirty : changeCount > 0;
  const reviewRequired = !isAuthenticated || !skipReview;
  const requiresLocation = mode === "add" || !base.initialForm.location;

  /**
   * Store the draft. While restored-draft conflicts are unresolved, the user's own values for
   * those fields are kept in it (not the newer ones on screen), so a reload asks again.
   */
  const persistDraft = () => {
    const stored = draftWithUnresolvedConflicts(
      base.initialForm,
      form,
      base.initial?.updatedAt,
      draftConflicts,
    );
    saveDraft(storageKey, stored.initialForm, stored.form, stored.baseUpdatedAt, {
      requestedView: start.requestedView,
    });
  };

  // Draft autosave: every change is kept in sessionStorage until it is saved or discarded.
  useEffect(() => {
    if (outcome || leaving) return;
    if (dirty || draftConflicts) persistDraft();
    else clearDraft(storageKey);
  }, [storageKey, base, form, dirty, draftConflicts, outcome, leaving]);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty || outcome || leaving) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowUnloadRef.current) return;
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, outcome, leaving]);

  useEffect(() => {
    if (outcome) outcomeRef.current?.focus();
  }, [outcome]);

  // The form renders after page load (client-only island), so the browser can't scroll to a
  // `#hours` / `#notes` / `#location` deep link by itself: do it once on mount.
  useEffect(() => {
    let hash = "";
    try {
      hash = decodeURIComponent((window.location.hash ?? "").replace(/^#/, ""));
    } catch {
      return;
    }
    if (!Object.hasOwn(SECTION_ANCHORS, hash)) return;
    const field = SECTION_ANCHORS[hash as keyof typeof SECTION_ANCHORS];
    const timer = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView?.({ block: "start" });
      focusField(fieldId(field), false);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const navigate = (href: string) => {
    allowUnloadRef.current = true;
    window.location.href = href;
  };

  /** Leave for `href`, asking first when there are unsaved changes. */
  const leaveTo = (href: string) => {
    if (dirty) setDiscardTarget(href);
    else navigate(href);
  };

  const clearError = (key: LooFormField) =>
    setFormErrors((fe) => (fe[key] ? { ...fe, [key]: undefined } : fe));

  const setLocation = (lat: number, lng: number) => {
    if (!isValidLatLng(lat, lng)) return;
    setForm((f) => ({ ...f, location: { lat, lng } }));
    clearError("location");
  };

  const setTri = (key: TriStateField) => (value: TriStateValue) => {
    setForm((f) => ({ ...f, [key]: value }));
    clearError(key);
  };

  const focusLater = (ref: { current: HTMLElement | null }) =>
    setTimeout(() => ref.current?.focus(), 0);

  const validate = (): boolean => {
    const errors: FormErrors = {};
    if (!form.name.trim()) errors.name = MESSAGES.nameRequired;
    if (pinMoving) {
      errors.location = form.location ? MESSAGES.locationUnconfirmed : MESSAGES.locationNotPlaced;
    } else if (form.location) {
      if (!isValidLatLng(form.location.lat, form.location.lng)) {
        errors.location = MESSAGES.locationInvalid;
      }
    } else if (requiresLocation) {
      errors.location = MESSAGES.locationRequired;
    }
    const hoursError = validateOpeningTimes(form.openingTimes);
    if (hoursError) errors.openingTimes = hoursError;
    setFormErrors(errors);

    if (Object.values(errors).some(Boolean)) {
      focusLater(errorSummaryRef);
      return false;
    }
    return true;
  };

  const save = async () => {
    if (submitting || leaving) return;
    setSubmitting(true);
    setSubmitError(null);
    setOutcome(null);

    const url = mode === "edit" && looId ? `${apiUrl}/api/loos/${looId}` : `${apiUrl}/api/loos`;
    const method = mode === "edit" ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      const body: unknown = await res.json().catch(() => null);
      const action = interpretSaveResponse(res.status, body, mode);

      switch (action.kind) {
        case "queued":
          clearDraft(storageKey);
          // "You suggested a change" marker (C5). A new toilet has no id yet, so its marker
          // is keyed by the pending change instead: toiletmap-pending:new:<pendingId>.
          if (mode === "edit" && looId) {
            rememberPendingChange(looId, "edit", action.pendingId ?? null);
          } else if (mode === "add" && action.pendingId) {
            rememberPendingChange(`new:${action.pendingId}`, "create", action.pendingId);
          }
          setReviewOpen(false);
          setOutcome("queued");
          return;
        case "unchanged":
          clearDraft(storageKey);
          setReviewOpen(false);
          setOutcome("unchanged");
          return;
        case "saved":
          // interpretSaveResponse only returns "saved" for a body with a valid id.
          clearDraft(storageKey);
          setLeaving(true);
          await applySavedLocally(body as LooDetail);
          navigate(`/loos/${encodeURIComponent(action.id)}?saved=1`);
          return;
        case "conflict":
          setReviewOpen(false);
          setSubmitError({
            kind: "conflict",
            current: action.current,
            fields: conflictingFields({
              initialForm: base.initialForm,
              form,
              current: action.current,
            }),
          });
          focusLater(alertsRef);
          return;
        case "auth":
        case "notFound":
          setReviewOpen(false);
          setSubmitError({ kind: action.kind });
          focusLater(alertsRef);
          return;
        case "error": {
          setReviewOpen(false);
          const mapped = fieldErrorsFromIssues(action.issues, FIELD_ORDER);
          const mappedFields = Object.entries(mapped.fields) as [LooFormField, string][];
          if (mappedFields.length > 0) {
            setFormErrors(
              Object.fromEntries(
                mappedFields.map(([field, message]) => [
                  field,
                  `${FIELD_LABELS[field]}: ${message}`,
                ]),
              ),
            );
            setSubmitError(
              mapped.other.length > 0
                ? { kind: "message", message: action.message, details: mapped.other }
                : null,
            );
            focusLater(errorSummaryRef);
          } else {
            setSubmitError({ kind: "message", message: action.message, details: action.details });
            focusLater(alertsRef);
          }
          return;
        }
      }
    } catch {
      setReviewOpen(false);
      setSubmitError({ kind: "message", message: "Something went wrong. Please try again." });
      focusLater(alertsRef);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (submitting || leaving || !canSave) return;
    if (!validate()) return;
    if (reviewRequired) setReviewOpen(true);
    else save();
  };

  const loadLatestKeepingChanges = () => {
    if (submitError?.kind !== "conflict") return;
    const rebased = rebaseOnCurrent({
      current: submitError.current,
      initialForm: base.initialForm,
      form,
      mode,
    });
    setBase({ initial: rebased.initial, initialForm: rebased.initialForm });
    setForm(rebased.form);
    setBaseVersion((v) => v + 1);
    setSubmitError(null);
    setFormErrors({});
  };

  const discardRestoredDraft = () => {
    clearDraft(storageKey);
    setForm(formStateFromLoo(base.initial, mode));
    setBaseVersion((v) => v + 1);
    setFormErrors({});
    setDraftRestored(false);
    setDraftConflicts(null);
  };

  /** Put the user's own draft values back over the newer ones someone else saved. */
  const restoreMyDraftValues = () => {
    if (!draftConflicts) return;
    setForm((f) => ({ ...f, ...draftConflicts.values }));
    setBaseVersion((v) => v + 1);
    setDraftConflicts(null);
  };

  const cancelHref = mode === "edit" && looId ? `/loos/${encodeURIComponent(looId)}` : "/";
  const fallbackPath =
    mode === "edit" && looId ? `/loos/${encodeURIComponent(looId)}/edit` : "/loos/add";

  if (outcome) {
    const toiletHref = mode === "edit" && looId ? `/loos/${encodeURIComponent(looId)}` : null;
    return (
      <div class={styles.page}>
        <div ref={outcomeRef} tabIndex={-1} class={styles.outcome}>
          {outcome === "queued" ? (
            <Banner variant="success" title="Thanks — a moderator will review your suggestion">
              {mode === "edit"
                ? "Your changes are awaiting review by a moderator, and will appear on the map once they've been checked."
                : "The new toilet is awaiting review by a moderator, and will appear on the map once it's been checked."}
            </Banner>
          ) : (
            <Banner variant="info">
              No changes were needed — this toilet already has these details.
            </Banner>
          )}
        </div>
        <div class={styles.outcomeActions}>
          {toiletHref && (
            <Button htmlElement="a" variant="secondary" href={toiletHref}>
              View this toilet
            </Button>
          )}
          <Button htmlElement="a" variant="secondary" href="/">
            Back to map
          </Button>
        </div>
        {outcome === "queued" && !isAuthenticated && (
          <p class={styles.signInPrompt}>
            <a href={loginHref(toiletHref ?? "/")}>Sign in to keep track of your contributions</a>
          </p>
        )}
      </div>
    );
  }

  const errorEntries = FIELD_ORDER.filter((field) => formErrors[field]).map(
    (field) => [field, formErrors[field] as string] as const,
  );
  const describedBy = (field: LooFormField, hintId?: string) =>
    [hintId, formErrors[field] ? `error-${field}` : undefined].filter(Boolean).join(" ") ||
    undefined;
  const fieldError = (field: LooFormField) =>
    formErrors[field] ? (
      <span id={`error-${field}`} class={styles.fieldError}>
        {formErrors[field]}
      </span>
    ) : null;

  const tri = (field: TriStateField, label: string, hint?: string) => (
    <div id={fieldId(field)} class={styles.triField}>
      <TriStateToggle
        name={field}
        label={label}
        hint={hint}
        value={form[field]}
        error={formErrors[field]}
        onChange={setTri(field)}
      />
    </div>
  );

  const saveLabel = leaving
    ? "Saved"
    : submitting
      ? "Saving…"
      : mode === "add"
        ? "Add toilet"
        : changeCount === 0
          ? "No changes to save"
          : `Save ${changeCount} change${changeCount === 1 ? "" : "s"}`;

  // Says what a save will do: signed-in users' changes go live straight away (the server may
  // still queue one, e.g. from a user blocked in Auth0, and the queued screen then says so).
  const actionStatus = !trusted
    ? MODERATOR_WILL_CHECK
    : mode === "edit" && changeCount === 0
      ? "Change any answer to save."
      : LIVE_STRAIGHT_AWAY;

  return (
    <form class={styles.page} onSubmit={handleSubmit} noValidate>
      <h1 class={styles.heading}>{mode === "edit" ? "Edit toilet" : "Add a toilet"}</h1>
      <p class={styles.intro}>
        Answer what you know. Anything you're not sure about can stay as “Don't know”.
      </p>

      {pendingSuggestion && (
        <Banner variant="info">
          You suggested changes to this toilet {formatSuggestedOn(pendingSuggestion.at)} — they're
          awaiting review by a moderator.
        </Banner>
      )}

      {draftRestored && (
        <div class={styles.restored}>
          <Banner variant="info">
            Restored your unsaved changes.
            {start.pinSkipped && " The map is where you asked, not where your earlier pin was."}{" "}
            <button type="button" class={styles.linkButton} onClick={discardRestoredDraft}>
              Discard
            </button>
          </Banner>
        </div>
      )}

      {draftConflicts && (
        <div class={styles.restored}>
          <Banner variant="warning" title={CONFLICT_MESSAGE}>
            <p>You'd also changed these, so we're showing their newer version instead of yours:</p>
            <ul class={styles.errorList}>
              {draftConflicts.fields.map((field) => (
                <li key={field}>{FIELD_LABELS[field]}</li>
              ))}
            </ul>
            <p>Check them before you save, or put your own back.</p>
            <div class={styles.bannerActions}>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={restoreMyDraftValues}
              >
                Use my changes instead
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={() => setDraftConflicts(null)}
              >
                Keep their version
              </Button>
            </div>
          </Banner>
        </div>
      )}

      {errorEntries.length > 0 && (
        <div ref={errorSummaryRef} tabIndex={-1} class={styles.errorSummary}>
          <Banner variant="error" title="There's a problem">
            <ul class={styles.errorList}>
              {errorEntries.map(([field, message]) => (
                <li key={field}>
                  <a
                    href={`#${fieldId(field)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      focusField(fieldId(field));
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      <div ref={alertsRef} tabIndex={-1} class={styles.alerts}>
        {submitError?.kind === "message" && (
          <Banner variant="error">
            {submitError.message}
            {submitError.details && submitError.details.length > 0 && (
              <ul class={styles.errorList}>
                {submitError.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </Banner>
        )}

        {submitError?.kind === "auth" && (
          <Banner variant="error" title="Your sign-in has expired">
            <a
              href={loginHref(currentPath(fallbackPath))}
              onClick={() => {
                // The draft is kept in this tab and restored when the user comes back.
                persistDraft();
                allowUnloadRef.current = true;
              }}
            >
              Sign in again
            </a>{" "}
            — your changes are kept.
          </Banner>
        )}

        {submitError?.kind === "notFound" && (
          <Banner variant="error" title="This toilet no longer exists">
            It may have been removed while you were editing. <a href="/">Back to map</a>
          </Banner>
        )}

        {submitError?.kind === "conflict" && (
          <Banner variant="warning" title={CONFLICT_MESSAGE}>
            {submitError.fields.length > 0 ? (
              <>
                <p>These fields you changed have also been changed by someone else:</p>
                <ul class={styles.errorList}>
                  {submitError.fields.map((field) => (
                    <li key={field}>{FIELD_LABELS[field]}</li>
                  ))}
                </ul>
                <p>Loading the latest version keeps your values for these fields.</p>
              </>
            ) : (
              <p>None of the fields you changed were affected. Your changes will be kept.</p>
            )}
            <div class={styles.bannerActions}>
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={loadLatestKeepingChanges}
              >
                Load latest and keep my changes
              </Button>
            </div>
          </Banner>
        )}
      </div>

      <div class={styles.questions}>
        <Question
          number={1}
          id="q-name"
          title="What's it called?"
          titleFor={fieldId("name")}
          hint="Use the name on the sign, or say where it is, like “Market Square toilets”."
        >
          <InputField
            id={fieldId("name")}
            class={styles.input}
            value={form.name}
            autoComplete="off"
            aria-required="true"
            aria-invalid={formErrors.name ? "true" : undefined}
            aria-describedby={describedBy("name", "q-name-hint")}
            onInput={(e) => {
              setForm((f) => ({ ...f, name: (e.target as HTMLInputElement).value }));
              clearError("name");
            }}
          />
          {fieldError("name")}
        </Question>

        <Question
          number={2}
          id="q-location"
          anchor="location"
          title="Where is it?"
          // A new toilet's instruction is the picker's own ("…on the toilet's entrance").
          hint={mode === "edit" ? "Only move the pin if it's in the wrong place." : undefined}
        >
          <div
            id={fieldId("location")}
            tabIndex={-1}
            class={styles.locationField}
            aria-describedby={describedBy("location")}
          >
            <LocationPicker
              location={form.location}
              originalLocation={mode === "edit" ? base.initialForm.location : null}
              onChange={setLocation}
              mode={mode}
              apiUrl={apiUrl}
              excludeId={mode === "edit" ? looId : undefined}
              initialView={mode === "add" ? initialView : undefined}
              onMovingChange={(moving) => {
                setPinMoving(moving);
                if (!moving) clearError("location");
              }}
              onEditExisting={(id) => leaveTo(`/loos/${encodeURIComponent(id)}/edit`)}
              onRestoreExisting={(id) => leaveTo(`/loos/${encodeURIComponent(id)}?restore=1`)}
            />
          </div>
          {fieldError("location")}
        </Question>

        <Question
          number={3}
          id="q-who"
          title="Who can use it?"
          hint="Choose Yes, No or Don't know for each."
        >
          <div class={styles.triGrid}>
            {tri("women", "Women")}
            {tri("men", "Men")}
            {tri("allGender", "All gender", "One toilet anyone can use")}
            {tri("children", "Children")}
            {tri("urinalOnly", "Urinal only", "There are urinals but no cubicles")}
            {tri("babyChange", "Baby changing")}
          </div>
        </Question>

        <Question number={4} id="q-access" title="Accessibility">
          <div class={styles.triStack}>
            {tri("accessible", "Is there a wheelchair-accessible toilet?")}
            {tri("radar", "Does it need a RADAR key?", "RADAR keys open locked accessible toilets")}
          </div>
        </Question>

        <Question number={5} id="q-cost" title="Does it cost money?">
          <div class={styles.triStack}>
            {tri("noPayment", "Is it free to use?")}
            {form.noPayment === "false" && (
              <div class={styles.field}>
                <label class={styles.fieldLabel} for={fieldId("paymentDetails")}>
                  How much does it cost, and how can people pay?
                </label>
                <InputField
                  id={fieldId("paymentDetails")}
                  class={styles.input}
                  placeholder="For example: 50p, contactless only"
                  value={form.paymentDetails}
                  aria-invalid={formErrors.paymentDetails ? "true" : undefined}
                  aria-describedby={describedBy("paymentDetails")}
                  onInput={(e) => {
                    setForm((f) => ({
                      ...f,
                      paymentDetails: (e.target as HTMLInputElement).value,
                    }));
                    clearError("paymentDetails");
                  }}
                />
                {fieldError("paymentDetails")}
              </div>
            )}
          </div>
        </Question>

        <Question number={6} id="q-hours" anchor="hours" title="When is it open?">
          <OpeningHoursInput
            key={baseVersion}
            id={fieldId("openingTimes")}
            value={form.openingTimes}
            error={formErrors.openingTimes}
            onChange={(v) => {
              setForm((f) => ({ ...f, openingTimes: v }));
              clearError("openingTimes");
            }}
          />
        </Question>

        <Question
          number={7}
          id="q-notes"
          anchor="notes"
          title="Anything else people should know?"
          titleFor={fieldId("notes")}
          hint="For example: how to find it, if it's for customers only, or if it's closed for repairs."
        >
          <TextArea
            id={fieldId("notes")}
            class={styles.input}
            value={form.notes}
            rows={4}
            aria-invalid={formErrors.notes ? "true" : undefined}
            aria-describedby={describedBy("notes", "q-notes-hint")}
            onInput={(e) => {
              setForm((f) => ({ ...f, notes: (e.target as HTMLTextAreaElement).value }));
              clearError("notes");
            }}
          />
          {fieldError("notes")}
          <div class={styles.triStack}>
            {tri("automatic", "Is it an automatic (self-cleaning) toilet?")}
          </div>
        </Question>
      </div>

      <div class={styles.actionBar}>
        <div class={styles.actionBarInner}>
          {actionStatus && (
            <p class={styles.actionStatus}>
              {actionStatus}
              {!isAuthenticated && (
                <>
                  {" "}
                  <a
                    href={loginHref(currentPath(fallbackPath))}
                    onClick={() => {
                      // Changes so far are kept as a draft and restored after signing in.
                      allowUnloadRef.current = true;
                    }}
                  >
                    Sign in
                  </a>
                </>
              )}
            </p>
          )}
          <div class={styles.actionButtons}>
            <Button
              htmlElement="a"
              variant="secondary"
              href={cancelHref}
              onClick={(e: MouseEvent) => {
                if (!dirty) return;
                e.preventDefault();
                setDiscardTarget(cancelHref);
              }}
            >
              Cancel
            </Button>
            <Button
              htmlElement="button"
              type="submit"
              variant="primary"
              disabled={submitting || leaving || !canSave}
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      </div>

      <ReviewChanges
        open={reviewOpen}
        mode={mode}
        items={reviewOpen ? describeChanges({ mode, initialForm: base.initialForm, payload }) : []}
        submitting={submitting}
        saved={leaving}
        canWriteDirectly={trusted}
        onBack={() => setReviewOpen(false)}
        onConfirm={save}
      />

      <Dialog
        open={discardTarget !== null}
        role="alertdialog"
        labelledBy="discard-title"
        describedBy="discard-description"
        onDismiss={() => setDiscardTarget(null)}
        initialFocus="[data-autofocus]"
      >
        <h2 id="discard-title" class={styles.dialogTitle}>
          Discard your changes?
        </h2>
        <p id="discard-description" class={styles.dialogText}>
          {mode === "edit"
            ? `You've made ${changeCount} change${changeCount === 1 ? "" : "s"} that haven't been saved.`
            : "The details you've entered for this toilet haven't been saved."}
        </p>
        <div class={styles.dialogActions}>
          <Button
            htmlElement="button"
            type="button"
            variant="secondary"
            data-autofocus
            onClick={() => setDiscardTarget(null)}
          >
            Keep editing
          </Button>
          <Button
            htmlElement="button"
            type="button"
            variant="primary"
            onClick={() => {
              const target = discardTarget ?? cancelHref;
              clearDraft(storageKey);
              setDiscardTarget(null);
              navigate(target);
            }}
          >
            Discard changes
          </Button>
        </div>
      </Dialog>
    </form>
  );
}
