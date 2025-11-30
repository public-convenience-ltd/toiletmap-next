/** @jsxImportSource hono/jsx/dom */

import { useEffect, useState } from "hono/jsx";
import { useLooForm } from "../../shared/hooks/useLooForm";
import { LooForm } from "../../shared/LooForm.client";
import { buildPayload, validateForm } from "../../shared/utils/form";
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

export const EditLooApp = () => {
  const config = usePageConfig();

  if (!config) {
    return <div class="form-card">Loading edit form…</div>;
  }

  return <EditLooAppContent config={config} />;
};

const EditLooAppContent = ({ config }: { config: EditPageConfig }) => {
  const { form, updateField, updateTriState, updateOpeningHours, updateLocation } = useLooForm(
    config.defaults,
  );
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    hideServerShell();
  }, []);

  const handleTriStateChange = (field: keyof typeof form, value: TriStateValue) => {
    updateTriState(field, value);
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setServerError(null);

    const validation = validateForm(form);
    if (!validation.success) {
      setErrors(validation.errors || {});
      setStatus("error");
      focusFirstErrorField(validation.errors || {});
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
        body: JSON.stringify(buildPayload(validation.data)),
      });

      if (response.status === 401) {
        window.location.href = "/admin/login";
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
        const message =
          body &&
          typeof body === "object" &&
          typeof (body as { message?: unknown }).message === "string"
            ? (body as { message: string }).message
            : "The API rejected this request.";
        setServerError(message);
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
