import type { OpeningTimes, TriStateValue } from "toiletmap-design-system";
import { isValidLatLng, type LatLng } from "./geometry";
import {
  changedFormFields,
  fieldChanged,
  type LooFormField,
  type LooFormState,
  TRI_STATE_FIELDS,
  type TriStateField,
} from "./payload";

/**
 * Unsaved-changes drafts, kept in sessionStorage so an edit survives a reload, an expired
 * sign-in or a trip through the sign-in page in the same tab.
 *
 * A draft stores the baseline the user started from (and that record's `updatedAt`) as well
 * as their form, so that on restore only the fields they actually changed are re-applied, on
 * top of whatever the toilet looks like now. A field someone else has changed since is never
 * silently overwritten: it keeps the newer value and is reported as a conflict.
 */

const DRAFT_VERSION = 1;

/** Drafts older than this are dropped rather than restored. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** sessionStorage key: `loo-draft:<looId>` for an edit, `loo-draft:new` for a new toilet. */
export const draftKey = (looId?: string | null): string => `loo-draft:${looId || "new"}`;

export interface LooDraft {
  initialForm: LooFormState;
  form: LooFormState;
  savedAt: string;
  /** `updatedAt` of the record `initialForm` was built from (absent for a new toilet). */
  baseUpdatedAt?: string | null;
  /**
   * The spot a new toilet's page was opened at (`?lat&lng`) when the draft was started, so that
   * coming back to that same page (after signing in, or a reload) keeps the user's own pin.
   */
  requestedView?: LatLng | null;
}

export interface SaveDraftOptions {
  requestedView?: LatLng | null;
}

const storage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function saveDraft(
  key: string,
  initialForm: LooFormState,
  form: LooFormState,
  baseUpdatedAt?: string | null,
  { requestedView }: SaveDraftOptions = {},
): void {
  try {
    storage()?.setItem(
      key,
      JSON.stringify({
        v: DRAFT_VERSION,
        initialForm,
        form,
        baseUpdatedAt: baseUpdatedAt ?? null,
        requestedView: requestedView ? { lat: requestedView.lat, lng: requestedView.lng } : null,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Storage full or disabled: drafts are a convenience, never block editing.
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

const TRI_VALUES = new Set<string>(["true", "false", ""]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const readLocation = (value: unknown): LatLng | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { lat, lng } = value;
  return typeof lat === "number" && typeof lng === "number" && isValidLatLng(lat, lng)
    ? { lat, lng }
    : undefined;
};

const readOpeningTimes = (value: unknown): OpeningTimes | null | undefined => {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 7) return undefined;
  const days: OpeningTimes = [];
  for (const day of value) {
    if (!Array.isArray(day)) return undefined;
    if (day.length === 0) days.push([]);
    else if (day.length === 2 && typeof day[0] === "string" && typeof day[1] === "string") {
      days.push([day[0], day[1]]);
    } else return undefined;
  }
  return days;
};

/** Validate a stored form, so a corrupt or outdated draft can never break the page. */
function readFormState(value: unknown): LooFormState | null {
  if (!isRecord(value)) return null;
  const { name, notes, paymentDetails } = value;
  if (typeof name !== "string" || typeof notes !== "string" || typeof paymentDetails !== "string")
    return null;
  const location = readLocation(value.location);
  const openingTimes = readOpeningTimes(value.openingTimes);
  if (location === undefined || openingTimes === undefined) return null;
  const tri = {} as Record<TriStateField, TriStateValue>;
  for (const key of TRI_STATE_FIELDS) {
    const v = value[key];
    // A field added after the draft was written reads as "unknown".
    if (v === undefined) tri[key] = "";
    else if (typeof v === "string" && TRI_VALUES.has(v)) tri[key] = v as TriStateValue;
    else return null;
  }
  return { name, notes, paymentDetails, location, openingTimes, ...tri };
}

/**
 * The draft stored under `key`, or null when there is none, it can't be read, or it is older
 * than {@link DRAFT_MAX_AGE_MS} (an expired or unreadable draft is removed).
 */
export function loadDraft(key: string, now: number = Date.now()): LooDraft | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.v !== DRAFT_VERSION) return null;
    const initialForm = readFormState(parsed.initialForm);
    const form = readFormState(parsed.form);
    if (!initialForm || !form) return null;
    const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";
    const savedMs = Date.parse(savedAt);
    // No readable timestamp counts as expired: we can't tell how stale it is.
    if (!Number.isFinite(savedMs) || now - savedMs > DRAFT_MAX_AGE_MS) {
      clearDraft(key);
      return null;
    }
    return {
      initialForm,
      form,
      savedAt,
      baseUpdatedAt: typeof parsed.baseUpdatedAt === "string" ? parsed.baseUpdatedAt : null,
      requestedView: readLocation(parsed.requestedView) ?? null,
    };
  } catch {
    return null;
  }
}

export interface RestoredDraft {
  form: LooFormState;
  /**
   * Fields the user changed in the draft that someone else has also changed since (to a
   * different value). They keep the newer value from the server in `form`; `draftValues`
   * holds what the user had, so the form can offer to put them back.
   */
  conflicts: LooFormField[];
  draftValues: Partial<LooFormState>;
  /** Fields left out of the restore on purpose (`skip`), e.g. a location the URL overrides. */
  skipped: LooFormField[];
}

const copyValue = (field: LooFormField, value: unknown): unknown =>
  field === "openingTimes" && Array.isArray(value)
    ? (value as OpeningTimes).map((day) => [...day])
    : field === "location" && value && typeof value === "object"
      ? { ...(value as LatLng) }
      : value;

/**
 * The form to show when restoring `draft` onto the current baseline: the current values,
 * with each field the user had changed in the draft taken from the draft — except a field the
 * server has also changed since the draft was saved, which keeps the server's newer value and
 * is listed in `conflicts`. Returns null when there is nothing left to restore.
 *
 * `currentUpdatedAt` is the current record's `updatedAt`: when it matches the draft's, the
 * record is unchanged and nothing can conflict.
 */
export function applyDraft(
  draft: LooDraft,
  currentInitialForm: LooFormState,
  {
    currentUpdatedAt,
    skip = [],
  }: { currentUpdatedAt?: string | null; skip?: readonly LooFormField[] } = {},
): RestoredDraft | null {
  const changed = changedFormFields(draft.initialForm, draft.form);
  const skipped = changed.filter((field) => skip.includes(field));
  const wanted = changed.filter((field) => !skip.includes(field));
  if (wanted.length === 0) return null;
  const unchangedOnServer =
    !!currentUpdatedAt && !!draft.baseUpdatedAt && currentUpdatedAt === draft.baseUpdatedAt;
  const next: LooFormState = { ...currentInitialForm };
  const conflicts: LooFormField[] = [];
  const draftValues: Partial<LooFormState> = {};
  for (const field of wanted) {
    const serverChanged =
      !unchangedOnServer && fieldChanged(field, draft.initialForm, currentInitialForm);
    if (serverChanged) {
      // Someone else changed it too. If they made the same change there is nothing to do;
      // otherwise keep their newer value and let the user choose.
      if (fieldChanged(field, currentInitialForm, draft.form)) {
        conflicts.push(field);
        (draftValues as Record<LooFormField, unknown>)[field] = copyValue(field, draft.form[field]);
      }
      continue;
    }
    (next as Record<LooFormField, unknown>)[field] = copyValue(field, draft.form[field]);
  }
  // Nothing left to restore if the toilet already matches the draft.
  if (conflicts.length === 0 && changedFormFields(currentInitialForm, next).length === 0) {
    return null;
  }
  return { form: next, conflicts, draftValues, skipped };
}

/** Restored-draft fields that conflict with a newer version, until the user chooses. */
export interface UnresolvedDraftConflicts {
  fields: LooFormField[];
  /** The user's own values for `fields`. */
  values: Partial<LooFormState>;
  /** The baseline the user's values were made against (the restored draft's `initialForm`). */
  baseForm: LooFormState;
  baseUpdatedAt?: string | null;
}

/**
 * What to store as the draft while restored-draft conflicts are unresolved. The form shows the
 * newer server value for each conflicting field, so storing it as-is would drop the user's own
 * value (and the conflict) on the next reload. Instead each conflicting field the user hasn't
 * touched since is stored as it was in the original draft — their value, against the baseline
 * it was made from — under the original draft's `updatedAt`, so restoring it reports the same
 * conflict again. Every other field is stored against the current baseline as usual.
 */
export function draftWithUnresolvedConflicts(
  initialForm: LooFormState,
  form: LooFormState,
  baseUpdatedAt: string | null | undefined,
  conflicts: UnresolvedDraftConflicts | null,
): { initialForm: LooFormState; form: LooFormState; baseUpdatedAt: string | null } {
  const asIs = { initialForm, form, baseUpdatedAt: baseUpdatedAt ?? null };
  if (!conflicts) return asIs;
  // A conflicting field the user has since edited themselves is theirs now: stored as usual.
  const kept = conflicts.fields.filter(
    (field) => field in conflicts.values && !fieldChanged(field, initialForm, form),
  );
  if (kept.length === 0) return asIs;
  const storedInitial: LooFormState = { ...initialForm };
  const storedForm: LooFormState = { ...form };
  for (const field of kept) {
    (storedInitial as Record<LooFormField, unknown>)[field] = copyValue(
      field,
      conflicts.baseForm[field],
    );
    (storedForm as Record<LooFormField, unknown>)[field] = copyValue(
      field,
      conflicts.values[field],
    );
  }
  return {
    initialForm: storedInitial,
    form: storedForm,
    baseUpdatedAt: conflicts.baseUpdatedAt ?? null,
  };
}
