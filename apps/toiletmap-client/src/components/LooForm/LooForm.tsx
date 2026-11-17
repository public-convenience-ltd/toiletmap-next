import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Banner,
  Button,
  InputField,
  OpeningHoursInput,
  Stack,
  TextArea,
  TriStateToggle,
  type TriStateValue,
  validateOpeningTimes,
} from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import { applyLocalMutation } from "../../api/mapCache";
import { useNominatimSearch } from "../../hooks/useNominatimSearch";
import { isValidLatLng } from "./geometry";
import LocationPicker from "./LocationPicker";
import styles from "./LooForm.module.css";
import {
  buildLooPatch,
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

interface LooFormProps {
  mode: LooFormMode;
  initialData?: LooDetail | null;
  looId?: string;
  /** API origin. "" means same-origin relative URLs (the client worker proxies /api/*). */
  apiUrl: string;
  isAuthenticated: boolean;
}

type FormErrorKey = "name" | "location" | "coordinates" | "openingTimes";
type FormErrors = Partial<Record<FormErrorKey, string>>;

type SubmitError =
  | { kind: "message"; message: string; details?: string[] }
  | { kind: "auth" }
  | { kind: "notFound" }
  | { kind: "conflict"; current: LooDetail; fields: LooFormField[] };

const CONFLICT_MESSAGE = "This toilet was changed by someone else while you were editing.";

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

const formatCoord = (n: number | undefined) =>
  n === undefined ? "" : String(Number(n.toFixed(6)));

const parseCoord = (text: string): number | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

export default function LooForm({
  mode,
  initialData,
  looId,
  apiUrl,
  isAuthenticated,
}: LooFormProps) {
  // Baseline the user is editing against. Replaced when rebasing after a conflict.
  const [base, setBase] = useState(() => {
    const initial = initialData ?? null;
    return { initial, initialForm: formStateFromLoo(initial, mode) };
  });
  const [form, setForm] = useState<LooFormState>(() => formStateFromLoo(initialData, mode));
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  /** Terminal outcome that replaces the form: queued for moderation, or nothing needed changing. */
  const [outcome, setOutcome] = useState<"queued" | "unchanged" | null>(null);
  // Remounts the controlled opening-hours widget when the baseline is replaced.
  const [baseVersion, setBaseVersion] = useState(0);

  const [latText, setLatText] = useState(() => formatCoord(form.location?.lat));
  const [lngText, setLngText] = useState(() => formatCoord(form.location?.lng));

  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const pickerMapRef = useRef<L.Map | null>(null);

  // Search only pans/zooms the picker map; it never writes the toilet's location.
  const search = useNominatimSearch({ mapRef: pickerMapRef, selectZoom: 17 });

  const { payload, changedKeys } = useMemo(
    () => buildLooPatch({ initial: base.initial, initialForm: base.initialForm, form, mode }),
    [base, form, mode],
  );
  const changeCount = changedKeys.length;
  const hasChanges = mode === "add" || changeCount > 0;

  // Keep the coordinate text inputs in sync when the pin moves (drag / place / rebase).
  useEffect(() => {
    setLatText(formatCoord(form.location?.lat));
    setLngText(formatCoord(form.location?.lng));
  }, [form.location?.lat, form.location?.lng]);

  const requiresLocation = mode === "add" || !base.initialForm.location;

  const clearError = (key: FormErrorKey) =>
    setFormErrors((fe) => (fe[key] ? { ...fe, [key]: undefined } : fe));

  const setLocation = (lat: number, lng: number) => {
    if (!isValidLatLng(lat, lng)) return;
    setForm((f) => ({ ...f, location: { lat, lng } }));
    clearError("location");
    clearError("coordinates");
  };

  /**
   * Interpret the coordinate text inputs. Never yields NaN or out-of-range values.
   * When not `final` (i.e. on blur), a half-filled pair for an unplaced pin is not yet an error.
   */
  const readCoordinates = (
    final: boolean,
  ):
    | { kind: "unchanged" }
    | { kind: "error"; message: string }
    | { kind: "valid"; lat: number; lng: number } => {
    const current = form.location;
    // Untouched text: keep the unrounded value rather than replacing it with the rounded one.
    if (current && latText === formatCoord(current.lat) && lngText === formatCoord(current.lng)) {
      return { kind: "unchanged" };
    }
    if (!current && !latText.trim() && !lngText.trim()) return { kind: "unchanged" };
    if (!final && !current && (!latText.trim() || !lngText.trim())) return { kind: "unchanged" };
    const lat = parseCoord(latText);
    const lng = parseCoord(lngText);
    if (lat === null || lat < -90 || lat > 90) {
      return { kind: "error", message: "Latitude must be a number between -90 and 90." };
    }
    if (lng === null || lng < -180 || lng > 180) {
      return { kind: "error", message: "Longitude must be a number between -180 and 180." };
    }
    return { kind: "valid", lat, lng };
  };

  const commitCoordinates = () => {
    const result = readCoordinates(false);
    if (result.kind === "error") {
      setFormErrors((fe) => ({ ...fe, coordinates: result.message }));
    } else if (result.kind === "valid") {
      setLocation(result.lat, result.lng);
    } else {
      clearError("coordinates");
    }
  };

  const onCoordKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitCoordinates();
    }
  };

  const setTri = (key: TriStateField) => (value: TriStateValue) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): boolean => {
    const errors: FormErrors = {};
    if (!form.name.trim()) errors.name = "Name is required.";
    if (form.location) {
      if (!isValidLatLng(form.location.lat, form.location.lng)) {
        errors.coordinates = "The coordinates are not valid.";
      }
    } else if (requiresLocation) {
      errors.location = "Please set the toilet's location on the map.";
    }
    const coords = readCoordinates(true);
    if (coords.kind === "error") errors.coordinates = coords.message;
    const hoursError = validateOpeningTimes(form.openingTimes);
    if (hoursError) errors.openingTimes = hoursError;
    setFormErrors(errors);

    if (Object.values(errors).some(Boolean)) {
      setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    if (mode === "edit" && changeCount === 0) return;

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

      const body: unknown = res.status === 202 ? null : await res.json().catch(() => null);
      const action = interpretSaveResponse(res.status, body, mode);

      switch (action.kind) {
        case "queued":
        case "unchanged":
          setOutcome(action.kind);
          return;
        case "conflict":
          setSubmitError({
            kind: "conflict",
            current: action.current,
            fields: conflictingFields({
              initialForm: base.initialForm,
              form,
              current: action.current,
            }),
          });
          return;
        case "auth":
        case "notFound":
          setSubmitError({ kind: action.kind });
          return;
        case "error":
          setSubmitError({ kind: "message", message: action.message, details: action.details });
          return;
        case "saved":
          // interpretSaveResponse only returns "saved" for a body with a valid id.
          await applySavedLocally(body as LooDetail);
          window.location.href = `/loos/${encodeURIComponent(action.id)}?saved=1`;
          return;
      }
    } catch {
      setSubmitError({ kind: "message", message: "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
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
    setBaseVersion((v) => v + 1);
    setSubmitError(null);
    setFormErrors({});
  };

  if (outcome) {
    return (
      <div class={styles.page}>
        {outcome === "queued" ? (
          <Banner variant="success" title="Thank you!">
            Your change has been submitted and is awaiting review by a moderator.
          </Banner>
        ) : (
          <Banner variant="info">
            No changes were needed — this toilet already has these details.
          </Banner>
        )}
        <div class={styles.queuedActions}>
          <Stack direction="row" space="s">
            {mode === "edit" && looId && (
              <Button htmlElement="a" variant="secondary" href={`/loos/${looId}`}>
                View this toilet
              </Button>
            )}
            <Button htmlElement="a" variant="secondary" href="/">
              Back to map
            </Button>
          </Stack>
        </div>
      </div>
    );
  }

  const errorEntries = Object.entries(formErrors).filter(([, v]) => v) as [FormErrorKey, string][];
  const cancelHref = mode === "edit" && looId ? `/loos/${looId}` : "/";
  const saveLabel = submitting
    ? "Saving…"
    : mode === "add"
      ? "Add toilet"
      : changeCount === 0
        ? "No changes to save"
        : `Save ${changeCount} change${changeCount === 1 ? "" : "s"}`;

  return (
    <form class={styles.page} onSubmit={handleSubmit} noValidate>
      <h1 class={styles.heading}>{mode === "edit" ? "Edit toilet" : "Add a toilet"}</h1>

      {errorEntries.length > 0 && (
        <div ref={errorSummaryRef} tabIndex={-1}>
          <Banner variant="error" title="Please fix the following errors before saving:">
            <ul class={styles.errorList}>
              {errorEntries.map(([key, msg]) => (
                <li key={key}>{msg}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

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
        <Banner variant="error">
          Your sign-in has expired. Please <a href="/auth/login">sign in again</a>.
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

      <div class={styles.layout}>
        {/* Location */}
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>Location</h2>
          <div class={styles.searchRow}>
            <InputField
              placeholder="Search for an address…"
              value={search.query}
              onInput={(e) => search.handleSearchInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                // Don't submit the form from the search box.
                if (e.key === "Enter") e.preventDefault();
              }}
              autoComplete="off"
              aria-label="Search for an address to move the map there"
            />
            {search.suggestions.length > 0 && (
              <ul class={styles.suggestions}>
                {search.suggestions.map((s) => (
                  <li key={s.place_id}>
                    <button
                      type="button"
                      class={styles.suggestion}
                      onClick={() => search.handleSuggestionSelect(s)}
                    >
                      {s.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <LocationPicker
            location={form.location}
            originalLocation={mode === "edit" ? base.initialForm.location : null}
            onChange={setLocation}
            onMapReady={(map) => {
              pickerMapRef.current = map;
            }}
          />
          {formErrors.location && (
            <span class={styles.fieldError} role="alert">
              {formErrors.location}
            </span>
          )}
          <div class={styles.coordRow}>
            <Stack direction="row" space="s">
              <label class={styles.coordLabel} for="field-latitude">
                Latitude
                <InputField
                  id="field-latitude"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={latText}
                  aria-invalid={formErrors.coordinates ? "true" : undefined}
                  aria-describedby={formErrors.coordinates ? "error-coordinates" : undefined}
                  onInput={(e) => setLatText((e.target as HTMLInputElement).value)}
                  onBlur={commitCoordinates}
                  onKeyDown={onCoordKeyDown}
                />
              </label>
              <label class={styles.coordLabel} for="field-longitude">
                Longitude
                <InputField
                  id="field-longitude"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={lngText}
                  aria-invalid={formErrors.coordinates ? "true" : undefined}
                  aria-describedby={formErrors.coordinates ? "error-coordinates" : undefined}
                  onInput={(e) => setLngText((e.target as HTMLInputElement).value)}
                  onBlur={commitCoordinates}
                  onKeyDown={onCoordKeyDown}
                />
              </label>
            </Stack>
            {formErrors.coordinates && (
              <span id="error-coordinates" class={styles.fieldError} role="alert">
                {formErrors.coordinates}
              </span>
            )}
          </div>
        </section>

        {/* Basic info */}
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>Details</h2>
          <Stack space="s">
            <div class={styles.fieldLabel}>
              <label for="field-name">
                Name{" "}
                <span class={styles.required} aria-hidden="true">
                  *
                </span>
              </label>
              <InputField
                id="field-name"
                placeholder="e.g. High Street toilets"
                value={form.name}
                aria-required="true"
                aria-invalid={formErrors.name ? "true" : undefined}
                aria-describedby={formErrors.name ? "error-name" : undefined}
                onInput={(e) => {
                  setForm((f) => ({ ...f, name: (e.target as HTMLInputElement).value }));
                  clearError("name");
                }}
              />
              {formErrors.name && (
                <span id="error-name" class={styles.fieldError} role="alert">
                  {formErrors.name}
                </span>
              )}
            </div>
            <div class={styles.fieldLabel}>
              <span>Notes</span>
              <TextArea
                placeholder="Anything noteworthy about this toilet…"
                aria-label="Notes"
                value={form.notes}
                onInput={(e) =>
                  setForm((f) => ({ ...f, notes: (e.target as HTMLTextAreaElement).value }))
                }
                rows={3}
              />
            </div>
          </Stack>
        </section>

        {/* Opening hours */}
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>Opening hours</h2>
          <OpeningHoursInput
            key={baseVersion}
            value={form.openingTimes}
            error={formErrors.openingTimes}
            onChange={(v) => {
              setForm((f) => ({ ...f, openingTimes: v }));
              clearError("openingTimes");
            }}
          />
        </section>

        {/* Features */}
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>Access & facilities</h2>
          <div class={styles.triGrid}>
            <TriStateToggle
              name="accessible"
              label="Accessible"
              value={form.accessible}
              onChange={setTri("accessible")}
            />
            <TriStateToggle
              name="allGender"
              label="All gender"
              value={form.allGender}
              onChange={setTri("allGender")}
            />
            <TriStateToggle name="men" label="Men" value={form.men} onChange={setTri("men")} />
            <TriStateToggle
              name="women"
              label="Women"
              value={form.women}
              onChange={setTri("women")}
            />
            <TriStateToggle
              name="children"
              label="Children"
              value={form.children}
              onChange={setTri("children")}
            />
            <TriStateToggle
              name="babyChange"
              label="Baby change"
              value={form.babyChange}
              onChange={setTri("babyChange")}
            />
            <TriStateToggle
              name="radar"
              label="Radar key"
              value={form.radar}
              onChange={setTri("radar")}
            />
            <TriStateToggle
              name="automatic"
              label="Automatic"
              value={form.automatic}
              onChange={setTri("automatic")}
            />
            <TriStateToggle
              name="noPayment"
              label="Free"
              value={form.noPayment}
              onChange={setTri("noPayment")}
            />
          </div>
          {form.noPayment === "false" && (
            <div class={styles.fieldLabel} style={{ marginTop: "var(--space-s)" }}>
              <span>Payment details</span>
              <InputField
                placeholder="e.g. 50p, card accepted"
                aria-label="Payment details"
                value={form.paymentDetails}
                onInput={(e) =>
                  setForm((f) => ({ ...f, paymentDetails: (e.target as HTMLInputElement).value }))
                }
              />
            </div>
          )}
        </section>
      </div>

      {/* Actions */}
      <div class={styles.actions}>
        {!isAuthenticated && (
          <p class={styles.anonNote}>
            You're not signed in — your change will be reviewed before going live.
          </p>
        )}
        <Stack direction="row" space="s">
          <Button htmlElement="a" variant="secondary" href={cancelHref}>
            Cancel
          </Button>
          <Button
            htmlElement="button"
            type="submit"
            variant="primary"
            disabled={submitting || !hasChanges}
          >
            {saveLabel}
          </Button>
        </Stack>
      </div>
    </form>
  );
}
