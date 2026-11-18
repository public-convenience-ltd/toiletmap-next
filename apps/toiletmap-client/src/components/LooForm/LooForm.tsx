import "leaflet/dist/leaflet.css";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Button,
  ConfirmDialog,
  InputField,
  Notice,
  OpeningHoursInput,
  TextArea,
  TriStateToggle,
  type TriStateValue,
  validateOpeningTimes,
} from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import { applyLocalMutation } from "../../api/mapCache";
import { readPendingChange, rememberPendingChange } from "../../api/reports";
import { useSoftKeyboardOpen } from "../../hooks/useSoftKeyboardOpen";
import { currentPath, loginHref } from "../../utils/returnTo";
import { type MapView, mapViewFromSearch } from "../LooMap/mapView";
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
import { distanceMeters, isValidLatLng, type LatLng } from "./geometry";
import { fieldErrorsFromIssues } from "./issues";
import LocationPicker, {
  type JumpKind,
  type LocationChangeSource,
  type LocationPickerHandle,
  type PendingLocation,
  type PickerIssue,
  type PickerResolution,
} from "./LocationPicker";
import { describeMove, formatDistance } from "./LocationPicker/move";
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
  locationMoved,
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
  /** A move of more than 50 m is never kept without "Use this location". */
  locationBigMove: "Confirm the big move with “Use this location”, or cancel it.",
  /** Editing: a search moved the pin. */
  locationJump: "Check the pin after your search, then choose “Use this location”.",
  /** Editing: "Use my location" or typed coordinates moved the pin. */
  locationJumpCheck: "Check the pin is on the toilet, then choose “Use this location”.",
  locationZoom: "Zoom in on the map so the pin can be placed accurately.",
  /** The picker's "Is it the same toilet?" question is still open. */
  locationDuplicate: (name: string) => `Tell us if this is the same toilet as ${name}.`,
} as const;

/** The error summary's message for what stops the picker keeping the pin. */
const locationIssueMessage = (resolution: {
  issue: PickerIssue;
  name?: string;
  jump?: JumpKind;
}): string => {
  switch (resolution.issue) {
    case "zoom":
      return MESSAGES.locationZoom;
    case "bigMove":
      return MESSAGES.locationBigMove;
    case "jump":
      return resolution.jump && resolution.jump !== "search"
        ? MESSAGES.locationJumpCheck
        : MESSAGES.locationJump;
    case "duplicate":
      return MESSAGES.locationDuplicate(resolution.name ?? "the toilet nearby");
  }
};

export const LIVE_STRAIGHT_AWAY = "Your change will go live straight away.";
export const MODERATOR_WILL_CHECK = "A moderator will check your change before it appears.";
/** The add form's version of LIVE_STRAIGHT_AWAY: there is no "change", it's a new toilet. */
export const ADDED_STRAIGHT_AWAY = "The toilet will go on the map straight away.";
/** The add form's version of MODERATOR_WILL_CHECK. */
export const ADD_MODERATOR_WILL_CHECK =
  "A moderator will check the new toilet before it appears on the map.";
/** Read out with the disabled "No changes to save" button on the edit form. */
export const NO_CHANGES_HINT = "Change any answer to save.";

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
  "accessible",
  "radar",
  "babyChange",
  "urinalOnly",
  "automatic",
  "noPayment",
  "paymentDetails",
  "openingTimes",
  "notes",
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
      // A restored location the user never confirmed (kept by carrying on, or still pending)
      // is asked about again on Save, as it would have been before the reload.
      locationUnconfirmed:
        !!restored &&
        !!draft?.locationUnconfirmed &&
        locationMoved(initialForm.location, restored.form.location),
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
  /** Where the picker's pin is while it hasn't been kept yet: it counts as a change. */
  const [pendingLocation, setPendingLocation] = useState<PendingLocation | null>(null);
  /** What stops the picker keeping the pin, when the last save attempt was blocked by it. */
  const [locationIssue, setLocationIssue] = useState<PickerIssue | null>(null);
  /**
   * "Is the pin on the toilet?": a new toilet's pin isn't placed (`accuracy`: it is at a rough
   * "Use my location" fix, in metres; otherwise the map was never moved).
   */
  const [pinCheck, setPinCheck] = useState<{ accuracy?: number } | null>(null);
  const pinCheckOpen = pinCheck !== null;
  /** "Save the new location?": the form to save, and how far the pin moved. */
  const [locationCheck, setLocationCheck] = useState<{ form: LooFormState; moved: string } | null>(
    null,
  );
  /** Save is waiting for the picker to settle (a duplicate check can take a moment). */
  const [resolving, setResolving] = useState(false);
  // Remounts the controlled opening-hours widget when the baseline is replaced.
  const [baseVersion, setBaseVersion] = useState(0);
  const [pendingSuggestion] = useState(() =>
    mode === "edit" && looId ? readPendingChange(looId) : null,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const pickerRef = useRef<LocationPickerHandle | null>(null);
  /** The form as it is now, including a location the picker kept since the last render. */
  const latestFormRef = useRef(form);
  latestFormRef.current = form;
  /** The location was last kept automatically (moving on), not with "Use this location". */
  const autoKeptRef = useRef(start.locationUnconfirmed);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  /** Navigation we started on purpose (save, discard, sign in): don't warn about it. */
  const allowUnloadRef = useRef(false);

  const { payload } = useMemo(
    () => buildLooPatch({ initial: base.initial, initialForm: base.initialForm, form, mode }),
    [base, form, mode],
  );
  // A move the picker hasn't kept yet still counts: "Save 1 change", and leaving warns.
  const countedForm = useMemo(
    () => (pendingLocation ? { ...form, location: pendingLocation.location } : form),
    [form, pendingLocation],
  );
  const { changedKeys } = useMemo(
    () =>
      buildLooPatch({
        initial: base.initial,
        initialForm: base.initialForm,
        form: countedForm,
        mode,
      }),
    [base, countedForm, mode],
  );
  const changedFields = useMemo(
    () => changedFormFields(base.initialForm, countedForm),
    [base.initialForm, countedForm],
  );
  // The draft keeps a pending move only if moving on would keep it anyway (never a big move,
  // a search jump or a pin with an open duplicate question), and only once its duplicate check
  // is done: a restored location isn't checked again.
  const draftPending = !!pendingLocation?.keepable && pendingLocation.checked;
  const draftForm = draftPending ? countedForm : form;
  const draftDirty = useMemo(
    () => changedFormFields(base.initialForm, draftForm).length > 0,
    [base.initialForm, draftForm],
  );
  const dirty = changedFields.length > 0;
  const changeCount = changedKeys.length;
  const canSave = mode === "add" ? dirty : changeCount > 0;
  const reviewRequired = !isAuthenticated || !skipReview;
  const requiresLocation = mode === "add" || !base.initialForm.location;
  // On a phone with the keyboard up, the action bar would sit on top of the field being typed
  // in: slide it away until the keyboard goes (never with a mouse, and never mid-save).
  const keyboardOpen = useSoftKeyboardOpen(formRef);
  const actionBarHidden = keyboardOpen && !submitting && !leaving;

  /**
   * Store the draft. While restored-draft conflicts are unresolved, the user's own values for
   * those fields are kept in it (not the newer ones on screen), so a reload asks again.
   */
  const persistDraft = () => {
    const stored = draftWithUnresolvedConflicts(
      base.initialForm,
      draftForm,
      base.initial?.updatedAt,
      draftConflicts,
    );
    saveDraft(storageKey, stored.initialForm, stored.form, stored.baseUpdatedAt, {
      requestedView: start.requestedView,
      // Not confirmed with "Use this location": "Save the new location?" still has to ask.
      locationUnconfirmed: draftPending || autoKeptRef.current,
    });
  };

  // Draft autosave: every change is kept in sessionStorage until it is saved or discarded.
  useEffect(() => {
    if (outcome || leaving) return;
    if (draftDirty || draftConflicts) persistDraft();
    else clearDraft(storageKey);
  }, [storageKey, base, draftForm, draftDirty, draftConflicts, outcome, leaving]);

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

  const setLocation = (lat: number, lng: number, source?: LocationChangeSource) => {
    if (!isValidLatLng(lat, lng)) return;
    autoKeptRef.current = source === "auto";
    latestFormRef.current = { ...latestFormRef.current, location: { lat, lng } };
    setForm((f) => ({ ...f, location: { lat, lng } }));
    setLocationIssue(null);
    clearError("location");
  };

  const setTri = (key: TriStateField) => (value: TriStateValue) => {
    setForm((f) => ({ ...f, [key]: value }));
    clearError(key);
  };

  const focusLater = (ref: { current: HTMLElement | null }) =>
    setTimeout(() => ref.current?.focus(), 0);

  /**
   * Check `f` before saving. `picker` is what the location picker said when asked to settle:
   * a blocked pin is listed with what fixes it, and a never-moved new pin isn't an error (the
   * "Is the pin on the toilet?" question follows).
   */
  const validate = (f: LooFormState, picker: PickerResolution): boolean => {
    const errors: FormErrors = {};
    if (!f.name.trim()) errors.name = MESSAGES.nameRequired;
    if (picker.kind === "blocked") {
      errors.location = locationIssueMessage(picker);
    } else if (f.location) {
      if (!isValidLatLng(f.location.lat, f.location.lng)) {
        errors.location = MESSAGES.locationInvalid;
      }
    } else if (requiresLocation && picker.kind !== "unplaced") {
      errors.location = MESSAGES.locationRequired;
    }
    const hoursError = validateOpeningTimes(f.openingTimes);
    if (hoursError) errors.openingTimes = hoursError;
    setLocationIssue(picker.kind === "blocked" ? picker.issue : null);
    setFormErrors(errors);

    if (Object.values(errors).some(Boolean)) {
      focusLater(errorSummaryRef);
      return false;
    }
    return true;
  };

  const save = async (toSave: LooFormState = form) => {
    if (submitting || leaving) return;
    const requestBody =
      toSave === form
        ? payload
        : buildLooPatch({
            initial: base.initial,
            initialForm: base.initialForm,
            form: toSave,
            mode,
          }).payload;
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
        body: JSON.stringify(requestBody),
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
          // The map confirms it in a toast: "added" says a new toilet is on the map.
          navigate(
            `/loos/${encodeURIComponent(action.id)}?saved=${mode === "add" ? "added" : "1"}`,
          );
          return;
        case "conflict":
          setReviewOpen(false);
          setSubmitError({
            kind: "conflict",
            current: action.current,
            fields: conflictingFields({
              initialForm: base.initialForm,
              form: toSave,
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

  /** The review sheet (or, when it is skipped, the save itself) for `next`. */
  const proceed = (next: LooFormState) => {
    if (reviewRequired) setReviewOpen(true);
    else save(next);
  };

  /** Everything after the location is settled: nothing left to save, the location check, save. */
  const continueSave = (next: LooFormState) => {
    const keys = buildLooPatch({
      initial: base.initial,
      initialForm: base.initialForm,
      form: next,
      mode,
    }).changedKeys;
    // The pin went back where it was and nothing else changed: there is nothing to send.
    if (mode === "edit" && keys.length === 0) return;
    const saved = base.initialForm.location;
    if (
      trusted &&
      mode === "edit" &&
      autoKeptRef.current &&
      saved &&
      next.location &&
      locationMoved(saved, next.location)
    ) {
      const move = describeMove(saved, next.location);
      setLocationCheck({ form: next, moved: move.label.replace(/^Moved /, "") });
      return;
    }
    proceed(next);
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (submitting || leaving || resolving || !canSave) return;
    // Save waits for the picker: it keeps a safe pending move, or says what has to be answered.
    let picker: PickerResolution = { kind: "ok", location: form.location, source: null };
    const handle = pickerRef.current;
    if (handle) {
      setResolving(true);
      try {
        // For Save: a jump to typed coordinates or the device's position is kept, and then
        // checked like a dragged move ("Save the new location?"; the review sheet when signed
        // out), rather than refused with an error after the bar said "Save 1 change".
        picker = await handle.resolve({ save: true });
      } finally {
        setResolving(false);
      }
    }
    let next = latestFormRef.current;
    if (picker.kind === "ok" && picker.location) {
      next = { ...next, location: picker.location };
      latestFormRef.current = next;
      setPendingLocation(null);
    }
    if (!validate(next, picker)) return;
    if (picker.kind === "unplaced") {
      setPinCheck(picker.accuracy !== undefined ? { accuracy: picker.accuracy } : {});
      return;
    }
    continueSave(next);
  };

  /** "Yes, it's on the toilet": keep the never-moved pin where the map opened, then carry on. */
  const confirmPinWhereItIs = () => {
    setPinCheck(null);
    const at: LatLng | null = pickerRef.current?.placeHere() ?? null;
    if (!at) return;
    const next = { ...latestFormRef.current, location: at };
    latestFormRef.current = next;
    setPendingLocation(null);
    if (!validate(next, { kind: "ok", location: at, source: "confirmed" })) return;
    continueSave(next);
  };

  /** "No, keep the old location": undo only the move, and save anything else. */
  const keepOldLocation = () => {
    const check = locationCheck;
    setLocationCheck(null);
    if (!check) return;
    const reverted = { ...check.form, location: base.initialForm.location };
    autoKeptRef.current = false;
    latestFormRef.current = reverted;
    setForm(reverted);
    const keys = buildLooPatch({
      initial: base.initial,
      initialForm: base.initialForm,
      form: reverted,
      mode,
    }).changedKeys;
    if (keys.length > 0) {
      proceed(reverted);
    } else {
      // The move was the only change: back to the form, with nothing left to save.
      setTimeout(() => document.getElementById(fieldId("location"))?.focus(), 0);
    }
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
    setLocationIssue(null);
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
    // One outcome pattern (shared with the report flow): a heading, a Notice saying what
    // happens next, then the next step as the primary button.
    return (
      <div class={styles.page}>
        <div ref={outcomeRef} tabIndex={-1} class={styles.outcome}>
          <h1 class={styles.heading}>
            {outcome === "queued"
              ? "Thanks — a moderator will review your suggestion"
              : "No changes needed"}
          </h1>
          {outcome === "queued" ? (
            <Notice tone="success" announce="off">
              {mode === "edit"
                ? "Your changes are awaiting review by a moderator, and will appear on the map once they've been checked."
                : "The new toilet is awaiting review by a moderator, and will appear on the map once it's been checked."}
            </Notice>
          ) : (
            <Notice tone="info" announce="off">
              No changes were needed — this toilet already has these details.
            </Notice>
          )}
        </div>
        <div class={styles.outcomeActions}>
          {toiletHref && (
            <Button htmlElement="a" variant="primary" href={toiletHref}>
              View this toilet
            </Button>
          )}
          <Button htmlElement="a" variant={toiletHref ? "secondary" : "primary"} href="/">
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
  const saveNotice =
    mode === "add"
      ? trusted
        ? ADDED_STRAIGHT_AWAY
        : ADD_MODERATOR_WILL_CHECK
      : trusted
        ? LIVE_STRAIGHT_AWAY
        : MODERATOR_WILL_CHECK;
  // Why Save is disabled, for screen readers (the label already says "No changes to save").
  const saveHint =
    mode === "edit" && changeCount === 0 && !submitting && !leaving ? NO_CHANGES_HINT : null;

  return (
    <form ref={formRef} class={styles.page} onSubmit={handleSubmit} noValidate>
      <h1 class={styles.heading}>{mode === "edit" ? "Edit toilet" : "Add a toilet"}</h1>
      <p class={styles.intro}>
        Answer what you know. Anything you're not sure about can stay as “Don't know”.
      </p>

      <div class={styles.saveNotice}>
        <Notice tone="info" size="compact" announce="off">
          <p>
            {saveNotice}
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
        </Notice>
      </div>

      {pendingSuggestion && (
        <div class={styles.restored}>
          <Notice tone="info" announce="off">
            You suggested changes to this toilet {formatSuggestedOn(pendingSuggestion.at)} — they're
            awaiting review by a moderator.
          </Notice>
        </div>
      )}

      {draftRestored && (
        <div class={styles.restored}>
          <Notice
            tone="info"
            announce="off"
            action={{ label: "Discard", onClick: discardRestoredDraft }}
          >
            Restored your unsaved changes.
            {start.pinSkipped && " The map is where you asked, not where your earlier pin was."}
          </Notice>
        </div>
      )}

      {draftConflicts && (
        <div class={styles.restored}>
          <Notice
            tone="warning"
            title={CONFLICT_MESSAGE}
            headingLevel={2}
            announce="assertive"
            actions={
              <>
                <Button
                  htmlElement="button"
                  type="button"
                  variant="primary"
                  onClick={() => setDraftConflicts(null)}
                >
                  Keep their version
                </Button>
                <Button
                  htmlElement="button"
                  type="button"
                  variant="secondary"
                  onClick={restoreMyDraftValues}
                >
                  Use my changes instead
                </Button>
              </>
            }
          >
            <p>You'd also changed these, so we're showing their newer version instead of yours:</p>
            <ul class={styles.errorList}>
              {draftConflicts.fields.map((field) => (
                <li key={field}>{FIELD_LABELS[field]}</li>
              ))}
            </ul>
            <p>Check them before you save, or put your own back.</p>
          </Notice>
        </div>
      )}

      {errorEntries.length > 0 && (
        <div ref={errorSummaryRef} tabIndex={-1} class={styles.errorSummary}>
          <Notice tone="error" title="There's a problem" headingLevel={2}>
            <ul class={styles.errorList}>
              {errorEntries.map(([field, message]) => (
                <li key={field}>
                  <a
                    href={`#${fieldId(field)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      const picker = pickerRef.current;
                      if (field === "location" && locationIssue && picker) {
                        document
                          .getElementById(fieldId("location"))
                          ?.scrollIntoView?.({ block: "center" });
                        picker.fixIssue(locationIssue);
                        return;
                      }
                      focusField(fieldId(field));
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <div ref={alertsRef} tabIndex={-1} class={styles.alerts}>
        {submitError?.kind === "message" && (
          <Notice tone="error">
            {submitError.message}
            {submitError.details && submitError.details.length > 0 && (
              <ul class={styles.errorList}>
                {submitError.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}

        {submitError?.kind === "auth" && (
          <Notice tone="error" title="Your sign-in has expired" headingLevel={2}>
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
          </Notice>
        )}

        {submitError?.kind === "notFound" && (
          <Notice
            tone="error"
            title="This toilet no longer exists"
            headingLevel={2}
            action={{ label: "Back to map", href: "/" }}
          >
            It may have been removed while you were editing.
          </Notice>
        )}

        {submitError?.kind === "conflict" && (
          <Notice
            tone="warning"
            title={CONFLICT_MESSAGE}
            headingLevel={2}
            announce="assertive"
            actions={
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={loadLatestKeepingChanges}
              >
                Load latest and keep my changes
              </Button>
            }
          >
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
          </Notice>
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
          // No hint: the picker gives the one instruction for its state (adding: "…on the
          // toilet's entrance"; editing: the strip under the locked map and Move pin), so a
          // hint here would only repeat it.
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
              onPendingChange={setPendingLocation}
              onIssueChange={(issue) => {
                // Answered (zoomed in, said it's a different toilet…): the error is out of date.
                if (locationIssue && issue !== locationIssue) {
                  setLocationIssue(null);
                  clearError("location");
                }
              }}
              controllerRef={pickerRef}
              mode={mode}
              apiUrl={apiUrl}
              excludeId={mode === "edit" ? looId : undefined}
              initialView={mode === "add" ? initialView : undefined}
              onMovingChange={(moving) => {
                if (moving) return;
                setLocationIssue(null);
                clearError("location");
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
          </div>
        </Question>

        <Question number={4} id="q-access" title="Accessibility and facilities">
          <div class={styles.triStack}>
            {tri("accessible", "Is there a wheelchair-accessible toilet?")}
            {tri("radar", "Does it need a RADAR key?", "RADAR keys open locked accessible toilets")}
          </div>
          <div class={`${styles.triGrid} ${styles.triGridAfter}`}>
            {tri("babyChange", "Baby changing")}
            {tri("urinalOnly", "Urinal only", "There are urinals but no cubicles")}
          </div>
          <div class={styles.triStack}>
            {tri("automatic", "Is it an automatic (self-cleaning) toilet?")}
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
        </Question>
      </div>

      <div
        class={[styles.actionBar, actionBarHidden && styles.actionBarHidden]
          .filter(Boolean)
          .join(" ")}
        data-action-bar=""
        data-hidden={actionBarHidden ? "true" : undefined}
      >
        <div class={styles.actionBarInner}>
          <a
            class={styles.cancelButton}
            href={cancelHref}
            onClick={(e: MouseEvent) => {
              if (!dirty) return;
              e.preventDefault();
              setDiscardTarget(cancelHref);
            }}
          >
            Cancel
          </a>
          <Button
            htmlElement="button"
            type="submit"
            variant="primary"
            class={styles.saveButton}
            disabled={submitting || leaving || !canSave}
            aria-describedby={saveHint ? "save-hint" : undefined}
          >
            {saveLabel}
          </Button>
          {/* Hidden: only read as the button's description, not again as a line of its own. */}
          {saveHint && (
            <span id="save-hint" hidden>
              {saveHint}
            </span>
          )}
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
        onConfirm={() => save()}
      />

      <ConfirmDialog
        open={discardTarget !== null}
        tone="destructive"
        title="Discard your changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          const target = discardTarget ?? cancelHref;
          clearDraft(storageKey);
          setDiscardTarget(null);
          navigate(target);
        }}
        onCancel={() => setDiscardTarget(null)}
      >
        <p>
          {mode === "edit"
            ? `You've made ${changeCount} change${changeCount === 1 ? "" : "s"} that haven't been saved.`
            : "The details you've entered for this toilet haven't been saved."}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pinCheckOpen}
        title="Is the pin on the toilet?"
        confirmLabel="Yes, it's on the toilet"
        cancelLabel="Move the map"
        // Moving the map is the safer answer: a pin left where the map opened is often wrong.
        initialFocus="cancel"
        onConfirm={confirmPinWhereItIs}
        onCancel={() => {
          setPinCheck(null);
          pickerRef.current?.focusMap();
        }}
        onDismiss={() => setPinCheck(null)}
      >
        <p>
          {pinCheck?.accuracy !== undefined
            ? `The pin is at your approximate location, which is only accurate to about ${formatDistance(pinCheck.accuracy)}.`
            : "You haven't moved the map, so the pin is where the map opened."}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={locationCheck !== null}
        title="Save the new location?"
        confirmLabel="Yes, save the new location"
        cancelLabel="No, keep the old location"
        onConfirm={() => {
          const check = locationCheck;
          setLocationCheck(null);
          autoKeptRef.current = false;
          if (!check) return;
          // The move was the only change and this was its check: the review sheet would only
          // ask the same question again. Other changes still go through the sheet.
          const keys = buildLooPatch({
            initial: base.initial,
            initialForm: base.initialForm,
            form: check.form,
            mode,
          }).changedKeys;
          if (keys.length === 1 && keys[0] === "location") save(check.form);
          else proceed(check.form);
        }}
        onCancel={keepOldLocation}
        // Escape, the backdrop and × only close it: neither answer is assumed.
        onDismiss={() => setLocationCheck(null)}
      >
        <p>You moved the pin {locationCheck?.moved}.</p>
      </ConfirmDialog>
    </form>
  );
}
