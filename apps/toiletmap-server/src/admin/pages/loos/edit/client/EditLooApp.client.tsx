/** @jsxImportSource hono/jsx/dom */

import { useEffect, useState } from "hono/jsx";
import { useLooForm } from "../../shared/hooks/useLooForm";
import { LooForm } from "../../shared/LooForm.client";
import {
  buildEditBaseline,
  buildPayload,
  diffPayload,
  validateForm,
} from "../../shared/utils/form";
import type { FieldErrors, SubmissionStatus, TriStateValue } from "../../shared/utils/types";
import { usePageConfig } from "./hooks/usePageConfig";
import type { EditPageConfig } from "./utils/types";

const mapIssueObject = (issues: unknown): FieldErrors => {
  if (!issues || typeof issues !== "object") return {};
  const map: FieldErrors = {};
  Object.entries(issues as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === "string") {
      map[key] = value;
    } else if (value && typeof value === "object" && "_errors" in value) {
      const errors = (value as { _errors?: unknown[] })._errors;
      if (Array.isArray(errors) && errors.length > 0 && typeof errors[0] === "string") {
        map[key] = errors[0];
      }
    }
  });
  return map;
};

const hideServerShell = () => {
  const shell = document.querySelector("[data-loo-edit-shell]");
  if (shell && shell instanceof HTMLElement) {
    shell.style.display = "none";
  }
};

const scrollToSelector = (selector: string, options?: ScrollIntoViewOptions) => {
  if (typeof document === "undefined") return;
  const el = document.querySelector(selector);
  if (el && el instanceof HTMLElement) {
    el.scrollIntoView({
      behavior: "smooth",
      block: "center",
      ...options,
    });
  }
};

const focusFieldByName = (name: string) => {
  if (typeof document === "undefined") return;
  const field = document.querySelector(`[name="${name}"]`) as HTMLElement | null;
  if (field) {
    field.focus({ preventScroll: true });
    field.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

const focusFirstErrorField = (fieldErrors: FieldErrors) => {
  const firstKey = Object.keys(fieldErrors)[0];
  if (!firstKey) return;
  requestAnimationFrame(() => focusFieldByName(firstKey));
};

const redirectToDetails = (id: string) => {
  if (typeof window === "undefined") return;
  window.location.assign(`/admin/loos/${id}?source=edit`);
};

const CONFLICT_MESSAGE = "This toilet was changed by someone else while you were editing.";

const readMessage = (body: unknown, fallback: string): string =>
  body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
    ? (body as { message: string }).message
    : fallback;

export const EditLooApp = () => {
  const config = usePageConfig();

  if (!config) {
    return <div class="form-card">Loading edit form…</div>;
  }

  return <EditLooAppContent config={config} />;
};

const EditLooAppContent = ({ config }: { config: EditPageConfig }) => {
  const { initialForm, form, updateField, updateTriState, updateOpeningHours, updateLocation } =
    useLooForm(config.defaults);
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    hideServerShell();
  }, []);

  const handleTriStateChange = (field: keyof typeof form, value: TriStateValue) => {
    updateTriState(field, value);
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setServerError(null);
    setConflict(false);

    const validation = validateForm(form);
    if (!validation.success) {
      setErrors(validation.errors || {});
      setStatus("error");
      focusFirstErrorField(validation.errors || {});
      return;
    }

    // Send only what the moderator changed, so concurrent edits to other
    // fields are not overwritten with stale values. Cleared values are null.
    // The baseline uses the stored `active` (possibly NULL), so saving a
    // hidden toilet that the form shows as active re-activates it.
    const patch = diffPayload(
      buildEditBaseline(initialForm, config.defaults),
      buildPayload(validation.data),
    );
    if (Object.keys(patch).length === 0) {
      // Nothing to save.
      redirectToDetails(config.looId);
      return;
    }

    hideServerShell();
    setErrors({});
    setStatus("saving");

    try {
      const response = await fetch(config.api.update, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          ...patch,
          ...(config.baseUpdatedAt ? { baseUpdatedAt: config.baseUpdatedAt } : {}),
        }),
      });

      if (response.status === 401) {
        window.location.href = "/admin/login";
        return;
      }

      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        setConflict(true);
        setServerError(readMessage(body, CONFLICT_MESSAGE));
        setStatus("error");
        requestAnimationFrame(() => scrollToSelector("[data-error-banner]", { block: "center" }));
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const apiIssues =
          body && typeof body === "object" ? (body as Record<string, unknown>).issues : null;
        if (apiIssues) {
          const issueMap = mapIssueObject(apiIssues);
          setErrors(issueMap);
          focusFirstErrorField(issueMap);
        }
        setServerError(readMessage(body, "The API rejected this request."));
        setStatus("error");
        requestAnimationFrame(() => scrollToSelector("[data-error-banner]", { block: "center" }));
        return;
      }

      // Redirect to detail page after successful edit
      redirectToDetails(config.looId);
    } catch (error) {
      console.error("Failed to submit loo edit request", error);
      setServerError("Unexpected error while saving. Please try again.");
      setStatus("error");
      requestAnimationFrame(() => scrollToSelector("[data-error-banner]", { block: "center" }));
    }
  };

  return (
    <LooForm
      form={form}
      errors={errors}
      status={status}
      serverError={serverError}
      conflict={conflict}
      formId="loo-edit-form"
      mode="edit"
      onFieldChange={(field, value) => updateField(field, value)}
      onTriStateChange={handleTriStateChange}
      onOpeningHoursChange={updateOpeningHours}
      onLocationChange={updateLocation}
      onSubmit={handleSubmit}
    />
  );
};
