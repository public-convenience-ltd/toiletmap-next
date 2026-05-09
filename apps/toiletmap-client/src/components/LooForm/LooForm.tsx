import "leaflet/dist/leaflet.css";
import { del } from "idb-keyval";
import { useRef, useState } from "preact/hooks";
import {
  Banner,
  Button,
  InputField,
  OpeningHoursInput,
  type OpeningTimes,
  Stack,
  TextArea,
  TriStateToggle,
  type TriStateValue,
} from "toiletmap-design-system";
import { CACHE_KEYS } from "../../api/constants";
import type { LooDetail } from "../../api/loos";
import { useNominatimSearch } from "../../hooks/useNominatimSearch";
import LocationPicker from "./LocationPicker";
import styles from "./LooForm.module.css";

interface LooFormProps {
  mode: "edit" | "add";
  initialData?: LooDetail | null;
  looId?: string;
  apiUrl: string;
  isAuthenticated: boolean;
  accessToken?: string | null;
}

type FormState = {
  name: string;
  lat: number;
  lng: number;
  notes: string;
  paymentDetails: string;
  removalReason: string;
  accessible: TriStateValue;
  allGender: TriStateValue;
  men: TriStateValue;
  women: TriStateValue;
  children: TriStateValue;
  babyChange: TriStateValue;
  radar: TriStateValue;
  automatic: TriStateValue;
  noPayment: TriStateValue;
  active: TriStateValue;
  openingTimes: OpeningTimes | null;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const boolToTri = (v: boolean | null | undefined): TriStateValue =>
  v === true ? "true" : v === false ? "false" : "";

const triToBool = (v: TriStateValue): boolean | null =>
  v === "true" ? true : v === "false" ? false : null;

// Default lat/lng for new toilets — used to detect "location not set"
const DEFAULT_LAT = 51.505;
const DEFAULT_LNG = -0.09;

const buildInitialState = (data?: LooDetail | null, mode?: "edit" | "add"): FormState => ({
  name: data?.name ?? "",
  lat: data?.location?.lat ?? DEFAULT_LAT,
  lng: data?.location?.lng ?? DEFAULT_LNG,
  notes: (data?.notes as string | undefined) ?? "",
  paymentDetails: data?.paymentDetails ?? "",
  removalReason: (data?.removalReason as string | undefined) ?? "",
  accessible: boolToTri(data?.accessible),
  allGender: boolToTri(data?.allGender),
  men: boolToTri(data?.men),
  women: boolToTri(data?.women),
  children: boolToTri(data?.children),
  babyChange: boolToTri(data?.babyChange),
  radar: boolToTri(data?.radar),
  automatic: boolToTri(data?.automatic),
  noPayment: boolToTri(data?.noPayment),
  // New toilets default to active; edits preserve current value
  active:
    mode === "add"
      ? "true"
      : boolToTri((data as Record<string, unknown> | undefined)?.active as boolean | undefined),
  openingTimes: (data?.openingTimes as OpeningTimes | null) ?? null,
});

export default function LooForm({
  mode,
  initialData,
  looId,
  apiUrl,
  isAuthenticated,
  accessToken,
}: LooFormProps) {
  const [form, setForm] = useState<FormState>(() => buildInitialState(initialData, mode));
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const locationSectionRef = useRef<HTMLElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const search = useNominatimSearch({
    onSelect: (lat, lng) => setForm((f) => ({ ...f, lat, lng })),
  });

  const setTri = (key: keyof FormState) => (value: TriStateValue) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): boolean => {
    const errors: FormErrors = {};
    if (!form.name.trim()) errors.name = "Name is required.";
    if (mode === "add" && form.lat === DEFAULT_LAT && form.lng === DEFAULT_LNG) {
      errors.lat = "Please set the toilet's location on the map.";
    }
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      // Focus/scroll to first error after state settles
      setTimeout(() => {
        if (errors.name) {
          nameRef.current?.focus();
        } else if (errors.lat) {
          locationSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        errorSummaryRef.current?.focus();
      }, 0);
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    setQueued(false);

    const payload = {
      name: form.name || undefined,
      location: { lat: form.lat, lng: form.lng },
      notes: form.notes || undefined,
      paymentDetails: form.paymentDetails || undefined,
      removalReason: form.removalReason || undefined,
      accessible: triToBool(form.accessible),
      allGender: triToBool(form.allGender),
      men: triToBool(form.men),
      women: triToBool(form.women),
      children: triToBool(form.children),
      babyChange: triToBool(form.babyChange),
      radar: triToBool(form.radar),
      automatic: triToBool(form.automatic),
      noPayment: triToBool(form.noPayment),
      active: triToBool(form.active),
      openingTimes: form.openingTimes,
    };

    const url = mode === "edit" && looId ? `${apiUrl}/api/loos/${looId}` : `${apiUrl}/api/loos`;
    const method = mode === "edit" ? "PUT" : "POST";

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (res.status === 202) {
        setQueued(true);
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setError((body.message as string) || `Error ${res.status}`);
        return;
      }

      const saved = (await res.json()) as LooDetail;
      // Clear stale compressed list so the map re-fetches fresh data on next load
      await Promise.all([del(CACHE_KEYS.LOOS_LIST), del(CACHE_KEYS.LAST_UPDATED)]);
      window.location.href = `/loo/${saved.id}`;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (queued) {
    return (
      <div class={styles.page}>
        <Banner variant="success" title="Thank you!">
          Your change has been submitted and is awaiting review by a moderator.
        </Banner>
        <div class={styles.queuedActions}>
          <Button htmlElement="a" variant="secondary" href="/">
            Back to map
          </Button>
        </div>
      </div>
    );
  }

  const errorEntries = Object.entries(formErrors).filter(([, v]) => v);

  return (
    <form class={styles.page} onSubmit={handleSubmit} noValidate>
      <h1 class={styles.heading}>{mode === "edit" ? "Edit toilet" : "Add a toilet"}</h1>

      {errorEntries.length > 0 && (
        <div ref={errorSummaryRef} tabIndex={-1}>
          <Banner variant="error" title="Please fix the following errors before saving:">
            <ul class={styles.errorList}>
              {errorEntries.map(([, msg]) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {error && <Banner variant="error">{error}</Banner>}

      <div class={styles.layout}>
        <div class={styles.main}>
          {/* Location */}
          <section class={styles.section} ref={locationSectionRef}>
            <h2 class={styles.sectionTitle}>Location</h2>
            <div class={styles.searchRow}>
              <InputField
                placeholder="Search for an address…"
                value={search.query}
                onInput={(e) => search.handleSearchInput((e.target as HTMLInputElement).value)}
                aria-label="Search for an address to jump to it on the map"
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
              lat={form.lat}
              lng={form.lng}
              onChange={(lat, lng) => {
                setForm((f) => ({ ...f, lat, lng }));
                if (formErrors.lat) setFormErrors((fe) => ({ ...fe, lat: undefined }));
              }}
            />
            {formErrors.lat && (
              <span class={styles.fieldError} role="alert">
                {formErrors.lat}
              </span>
            )}
            <Stack direction="row" space="s">
              <div class={styles.coordLabel}>
                Latitude
                <InputField
                  type="number"
                  step="any"
                  value={String(form.lat)}
                  onInput={(e) =>
                    setForm((f) => ({
                      ...f,
                      lat: Number.parseFloat((e.target as HTMLInputElement).value),
                    }))
                  }
                  aria-label="Latitude"
                />
              </div>
              <div class={styles.coordLabel}>
                Longitude
                <InputField
                  type="number"
                  step="any"
                  value={String(form.lng)}
                  onInput={(e) =>
                    setForm((f) => ({
                      ...f,
                      lng: Number.parseFloat((e.target as HTMLInputElement).value),
                    }))
                  }
                  aria-label="Longitude"
                />
              </div>
            </Stack>
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
                  ref={nameRef}
                  placeholder="e.g. High Street toilets"
                  value={form.name}
                  aria-required="true"
                  aria-invalid={formErrors.name ? "true" : undefined}
                  aria-describedby={formErrors.name ? "error-name" : undefined}
                  onInput={(e) => {
                    setForm((f) => ({ ...f, name: (e.target as HTMLInputElement).value }));
                    if (formErrors.name) setFormErrors((fe) => ({ ...fe, name: undefined }));
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
              value={form.openingTimes}
              onChange={(v) => setForm((f) => ({ ...f, openingTimes: v }))}
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

        {/* Sidebar */}
        {mode === "edit" && (
          <aside class={styles.aside}>
            <section class={styles.section}>
              <h2 class={styles.sectionTitle}>Remove this toilet</h2>
              <p class={styles.hint}>
                Set Active to "No" if this toilet has been closed or removed.
              </p>
              <Stack space="s">
                <TriStateToggle
                  name="active"
                  label="Active"
                  value={form.active}
                  onChange={setTri("active")}
                />
                {form.active === "false" && (
                  <div class={styles.fieldLabel}>
                    <span>Reason for removal</span>
                    <TextArea
                      placeholder="e.g. demolished, permanently closed"
                      aria-label="Reason for removal"
                      value={form.removalReason}
                      onInput={(e) =>
                        setForm((f) => ({
                          ...f,
                          removalReason: (e.target as HTMLTextAreaElement).value,
                        }))
                      }
                      rows={3}
                    />
                  </div>
                )}
              </Stack>
            </section>
          </aside>
        )}
      </div>

      {/* Actions */}
      <div class={styles.actions}>
        {!isAuthenticated && (
          <p class={styles.anonNote}>
            You're not signed in — your change will be reviewed before going live.
          </p>
        )}
        <Stack direction="row" space="s">
          <Button
            htmlElement="a"
            variant="secondary"
            href={mode === "edit" && looId ? `/loo/${looId}` : "/"}
          >
            Cancel
          </Button>
          <Button htmlElement="button" variant="primary" disabled={submitting}>
            {submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Add toilet"}
          </Button>
        </Stack>
      </div>
    </form>
  );
}
