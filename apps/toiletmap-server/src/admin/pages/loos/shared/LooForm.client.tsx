/** @jsxImportSource hono/jsx/dom */

import type { OpeningTimes } from "../../../../services/loo/types";
import { FormSection } from "./components/FormSection.client";
import { InlineAlert } from "./components/InlineAlert.client";
import { TriStateField } from "./components/TriStateField.client";
import { LocationMapPicker } from "./LocationMapPicker.client";
import { OpeningHoursInput } from "./OpeningHoursInput.client";
import type { FieldErrors, LooFormState, SubmissionStatus, TriStateValue } from "./utils/types";

type LooFormProps = {
  form: LooFormState;
  errors: FieldErrors;
  status: SubmissionStatus;
  serverError: string | null;
  formId: string;
  mode: "create" | "edit";
  onSubmit: (event: Event) => void;
  onFieldChange: (field: keyof LooFormState, value: string) => void;
  onTriStateChange: (field: keyof LooFormState, value: TriStateValue) => void;
  onOpeningHoursChange: (value: OpeningTimes) => void;
  onLocationChange: (lat: number, lng: number) => void;
};

const TextField = ({
  label,
  name,
  value,
  onChange,
  placeholder,
  error,
  type = "text",
  description,
}: {
  label: string;
  name: keyof LooFormState;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  type?: string;
  description?: string;
}) => (
  <label class="form-field">
    <span class="form-label">{label}</span>
    <input
      class={`input ${error ? "input--error" : ""}`}
      type={type}
      name={name}
      value={value}
      placeholder={placeholder}
      aria-invalid={error ? "true" : "false"}
      onInput={(event) => {
        const target = event.target as HTMLInputElement;
        onChange(target.value);
      }}
    />
    {description && <p class="field-hint">{description}</p>}
    {error && <span class="form-error">{error}</span>}
  </label>
);

const TextAreaField = ({
  label,
  name,
  value,
  onChange,
  placeholder,
  error,
  rows = 3,
  description,
}: {
  label: string;
  name: keyof LooFormState;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  rows?: number;
  description?: string;
}) => (
  <label class="form-field">
    <span class="form-label">{label}</span>
    <textarea
      class={`text-area ${error ? "input--error" : ""}`}
      name={name}
      rows={rows}
      placeholder={placeholder}
      value={value}
      aria-invalid={error ? "true" : "false"}
      onInput={(event) => {
        const target = event.target as HTMLTextAreaElement;
        onChange(target.value);
      }}
    />
    {description && <p class="field-hint">{description}</p>}
    {error && <span class="form-error">{error}</span>}
  </label>
);

export const LooForm = ({
  form,
  errors,
  status,
  serverError,
  formId,
  mode,
  onSubmit,
  onFieldChange,
  onTriStateChange,
  onOpeningHoursChange,
  onLocationChange,
}: LooFormProps) => {
  const isSaving = status === "saving";
  const submitLabel = mode === "create" ? "Create loo" : "Save changes";
  const savingLabel = mode === "create" ? "Creating…" : "Saving…";

  return (
    <>
      <form id={formId} class="create-form" onSubmit={onSubmit} noValidate>
        {serverError && (
          <div data-error-banner>
            <InlineAlert
              variant="error"
              title={
                mode === "create" ? "We couldn't save that loo" : "We couldn't update that loo"
              }
              message={serverError}
            />
          </div>
        )}

        <div class="create-layout">
          <div class="create-main">
            <FormSection
              eyebrow="Basics"
              title="Identity & context"
              description="Name, optional notes, and anything that helps future editors recognise this loo."
            >
              <div class="field-grid field-grid--two">
                <TextField
                  label="Loo name"
                  name="name"
                  value={form.name}
                  onChange={(value) => onFieldChange("name", value)}
                  placeholder="e.g. High Street toilets"
                  error={errors.name}
                />
              </div>
              <TextAreaField
                label="Notes"
                name="notes"
                value={form.notes}
                onChange={(value) => onFieldChange("notes", value)}
                placeholder="Anything noteworthy about this loo…"
                rows={4}
                error={errors.notes}
              />
            </FormSection>

            <FormSection
              eyebrow="Location"
              title="Map Position"
              description="Drag the marker to set the exact location."
            >
              <LocationMapPicker
                lat={Number.parseFloat(form.lat)}
                lng={Number.parseFloat(form.lng)}
                onChange={(lat, lng) => onLocationChange(lat, lng)}
              />
              <div class="field-grid field-grid--two" style="margin-top: var(--space-s);">
                <TextField
                  label="Latitude"
                  name="lat"
                  type="text"
                  value={form.lat}
                  onChange={(value) => onFieldChange("lat", value)}
                  placeholder="51.5074"
                  error={errors.lat}
                  description="Negative values for southern hemisphere."
                />
                <TextField
                  label="Longitude"
                  name="lng"
                  type="text"
                  value={form.lng}
                  onChange={(value) => onFieldChange("lng", value)}
                  placeholder="-0.1278"
                  error={errors.lng}
                  description="Negative values for west of Greenwich."
                />
              </div>
            </FormSection>

            <FormSection
              eyebrow="Schedule"
              title="Opening Hours"
              description="Set the opening times for this loo."
            >
              <OpeningHoursInput
                value={form.openingTimes}
                onChange={onOpeningHoursChange}
                error={errors.openingTimes}
              />
            </FormSection>

            <FormSection
              eyebrow="Access"
              title="Access & payment"
              description="Flag the essentials that determine who can use the loo."
            >
              <div class="pill-grid">
                <TriStateField
                  label="Accessible"
                  name="accessible"
                  value={form.accessible}
                  onChange={onTriStateChange}
                  error={errors.accessible}
                />
                <TriStateField
                  label="RADAR key"
                  name="radar"
                  value={form.radar}
                  onChange={onTriStateChange}
                  error={errors.radar}
                />
                <TriStateField
                  label="Attended"
                  name="attended"
                  value={form.attended}
                  onChange={onTriStateChange}
                  error={errors.attended}
                />
                <TriStateField
                  label="Automatic"
                  name="automatic"
                  value={form.automatic}
                  onChange={onTriStateChange}
                  error={errors.automatic}
                />
                <TriStateField
                  label="No payment"
                  name="noPayment"
                  value={form.noPayment}
                  onChange={onTriStateChange}
                  error={errors.noPayment}
                />
              </div>
              <TextField
                label="Payment details"
                name="paymentDetails"
                value={form.paymentDetails}
                onChange={(value) => onFieldChange("paymentDetails", value)}
                placeholder="e.g. 50p, card accepted"
                error={errors.paymentDetails}
              />
            </FormSection>

            <FormSection
              eyebrow="Facilities"
              title="Features"
              description="Anything that sets this loo apart."
            >
              <div class="pill-grid pill-grid--dense">
                <TriStateField
                  label="Baby change"
                  name="babyChange"
                  value={form.babyChange}
                  onChange={onTriStateChange}
                  error={errors.babyChange}
                />
                <TriStateField
                  label="All gender"
                  name="allGender"
                  value={form.allGender}
                  onChange={onTriStateChange}
                  error={errors.allGender}
                />
                <TriStateField
                  label="Children"
                  name="children"
                  value={form.children}
                  onChange={onTriStateChange}
                  error={errors.children}
                />
                <TriStateField
                  label="Men"
                  name="men"
                  value={form.men}
                  onChange={onTriStateChange}
                  error={errors.men}
                />
                <TriStateField
                  label="Women"
                  name="women"
                  value={form.women}
                  onChange={onTriStateChange}
                  error={errors.women}
                />
                <TriStateField
                  label="Urinal only"
                  name="urinalOnly"
                  value={form.urinalOnly}
                  onChange={onTriStateChange}
                  error={errors.urinalOnly}
                />
              </div>
            </FormSection>
          </div>

          <aside class="create-side">
            <section class="form-card form-card--compact">
              <div>
                <p class="section-eyebrow">Status</p>
                <h3 class="section-title">Visibility</h3>
              </div>
              <TriStateField
                label="Active"
                name="active"
                value={form.active}
                onChange={onTriStateChange}
                hint='Set to "No" if this loo is removed or inaccessible.'
                compact
                error={errors.active}
              />
              <TextAreaField
                label="Removal reason"
                name="removalReason"
                value={form.removalReason}
                onChange={(value) => onFieldChange("removalReason", value)}
                placeholder="If inactive, explain why"
                rows={3}
                error={errors.removalReason}
              />
            </section>

            <section class="form-card form-card--compact">
              <p class="section-eyebrow">Submission tips</p>
              <ul class="create-tips">
                <li>Include precise coordinates to avoid duplicates.</li>
                <li>Only mark features you are confident about.</li>
                <li>Use notes for opening hours or seasonal info.</li>
              </ul>
            </section>
          </aside>
        </div>
      </form>

      <div class="form-actions form-actions--fixed">
        <p class="form-actions__meta">Changes are attributed to your authenticated account.</p>
        <div class="form-actions__buttons">
          <a class="button button--secondary" href="/admin/loos">
            Cancel
          </a>
          <button type="submit" class="button" form={formId} disabled={isSaving}>
            {isSaving ? savingLabel : submitLabel}
          </button>
        </div>
      </div>
    </>
  );
};
