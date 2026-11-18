import { useEffect, useRef, useState } from "preact/hooks";
import { Button, InputField, Notice, TextArea } from "toiletmap-design-system";
import {
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_FIELDS,
  FEEDBACK_LOO_PARAM,
  FEEDBACK_PATH,
  FEEDBACK_TEXT_MAX_LENGTH,
  type FeedbackErrors,
  type FeedbackField,
  feedbackHref,
  feedbackRoute,
  hasErrors,
  RATE_LIMITED_MESSAGE,
  sendFeedback,
  validateFeedback,
} from "../../api/feedback";
import { pageTitle } from "../../utils/seo";
import styles from "./FeedbackForm.module.css";

/** The toilet a message is about ("Report a problem → Something else"). */
export interface FeedbackLoo {
  id: string;
  /** Null when it has no name, or the API couldn't be reached to look it up. */
  name: string | null;
}

/**
 * Where the form starts. The page fills this in after a form post without JavaScript
 * (src/pages/feedback.astro): the values sent back, the errors, or the sent state.
 */
export interface FeedbackFormInitial {
  text?: string;
  email?: string;
  errors?: FeedbackErrors;
  /** A send that failed for another reason (rate limit, server down). */
  submitError?: string | null;
  sent?: boolean;
}

export interface FeedbackFormProps {
  /** Base URL for the browser's API calls ("" = the same-origin /api proxy). */
  apiUrl: string;
  loo?: FeedbackLoo | null;
  initial?: FeedbackFormInitial;
}

export const FIELD_IDS: Record<FeedbackField, string> = {
  text: "feedback-text",
  email: "feedback-email",
};

const HINT_IDS: Record<FeedbackField, string> = {
  text: "feedback-text-hint",
  email: "feedback-email-hint",
};

const errorId = (field: FeedbackField) => `${FIELD_IDS[field]}-error`;

export const SUBMIT_LABEL = "Send feedback";

/** The page's titles, the same as src/pages/feedback.astro sets on the server. */
export const FEEDBACK_TITLES = {
  form: pageTitle("Feedback"),
  failed: pageTitle("Error: Feedback"),
  sent: pageTitle("Feedback sent"),
} as const;

/**
 * Marks the page's introduction (src/pages/feedback.astro), which is outside the island:
 * hidden once a message has been sent here, as the server leaves it out of the sent page.
 */
export const FEEDBACK_INTRO_ATTRIBUTE = "data-feedback-intro";

/**
 * The feedback form. Server-rendered and hydrated (client:load): without JavaScript it is a
 * plain form post to /feedback, which validates, sends and answers with this same component;
 * with JavaScript it validates here and posts JSON to /api/feedback.
 *
 * Errors follow the add and edit forms: a summary at the top ("There's a problem") linking
 * to each field, which takes focus, plus the message by the field.
 */
export default function FeedbackForm({ apiUrl, loo = null, initial = {} }: FeedbackFormProps) {
  const [text, setText] = useState(initial.text ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [errors, setErrors] = useState<FeedbackErrors>(initial.errors ?? {});
  const [submitError, setSubmitError] = useState<string | null>(initial.submitError ?? null);
  const [sent, setSent] = useState(initial.sent ?? false);
  const [submitting, setSubmitting] = useState(false);
  /**
   * Bumped by every submit that didn't go through, so the summary or error takes focus
   * again even when its text hasn't changed. Starts at 1 when the server sent errors back.
   */
  const [attempt, setAttempt] = useState(
    hasErrors(initial.errors ?? {}) || initial.submitError ? 1 : 0,
  );

  const summaryRef = useRef<HTMLDivElement>(null);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const fieldRefs = {
    text: useRef<HTMLTextAreaElement>(null),
    email: useRef<HTMLInputElement>(null),
  };
  const mounted = useRef(false);
  const failedState = hasErrors(errors) || !!submitError;

  // Keep the title and the introduction in step with what the server would have rendered.
  useEffect(() => {
    if (!mounted.current) return;
    document.title = sent
      ? FEEDBACK_TITLES.sent
      : failedState
        ? FEEDBACK_TITLES.failed
        : FEEDBACK_TITLES.form;
    for (const intro of document.querySelectorAll<HTMLElement>(`[${FEEDBACK_INTRO_ATTRIBUTE}]`)) {
      intro.hidden = sent;
    }
  }, [sent, failedState, attempt]);

  useEffect(() => {
    if (attempt === 0) return;
    if (hasErrors(errors)) summaryRef.current?.focus();
    else if (submitError) submitErrorRef.current?.focus();
  }, [attempt]);

  useEffect(() => {
    // Only after a send in the browser: a page that loads already sent reads its heading.
    if (sent && mounted.current) sentRef.current?.focus();
    mounted.current = true;
  }, [sent]);

  const failed = (next: { errors?: FeedbackErrors; submitError?: string | null }) => {
    setErrors(next.errors ?? {});
    setSubmitError(next.submitError ?? null);
    setAttempt((n) => n + 1);
  };

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateFeedback({ text, email });
    if (hasErrors(found)) {
      failed({ errors: found });
      return;
    }
    setSubmitting(true);
    const outcome = await sendFeedback(apiUrl, { text, email, route: feedbackRoute(loo?.id) });
    setSubmitting(false);
    switch (outcome.kind) {
      case "sent":
        setErrors({});
        setSubmitError(null);
        setSent(true);
        return;
      case "invalid":
        failed({ errors: outcome.errors });
        return;
      case "rateLimited":
        failed({ submitError: RATE_LIMITED_MESSAGE });
        return;
      default:
        failed({ submitError: outcome.message });
    }
  };

  const looName = loo?.name?.trim() || "this toilet";
  const looHref = loo ? `/loos/${encodeURIComponent(loo.id)}` : null;

  if (sent) {
    return (
      <div class={styles.form}>
        <div ref={sentRef} tabIndex={-1} role="status" class={styles.focusTarget}>
          <Notice tone="success" title="Thank you, your message has been sent" announce="off">
            <p class={styles.noticeText}>
              The Toilet Map team reads every message. If you left an email address, we'll only use
              it to reply to you.
            </p>
          </Notice>
        </div>
        <div class={styles.actions}>
          {looHref ? (
            <>
              <Button htmlElement="a" variant="primary" href={looHref}>
                Back to the toilet
              </Button>
              <Button htmlElement="a" variant="secondary" href="/">
                Back to the map
              </Button>
            </>
          ) : (
            <Button htmlElement="a" variant="primary" href="/">
              Back to the map
            </Button>
          )}
          <Button htmlElement="a" variant="secondary" href={feedbackHref(loo?.id)}>
            Send another message
          </Button>
        </div>
      </div>
    );
  }

  const describedBy = (field: FeedbackField) =>
    [HINT_IDS[field], errors[field] ? errorId(field) : null].filter(Boolean).join(" ");

  const focusField = (field: FeedbackField) => {
    const element = fieldRefs[field].current;
    element?.scrollIntoView?.({ block: "center" });
    element?.focus();
  };

  return (
    <div class={styles.form}>
      {loo && looHref && (
        <div class={styles.context}>
          <Notice tone="info" size="compact" announce="off" icon="toilet">
            <p class={styles.noticeText}>
              Your message will be about <strong>{looName}</strong>.{" "}
              <a href={looHref}>View the toilet</a>
            </p>
          </Notice>
        </div>
      )}

      {hasErrors(errors) && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          class={`${styles.errorSummary} ${styles.focusTarget}`}
          // A page sent back by the server (no JavaScript) still lands on the summary.
          autoFocus={attempt === 1 && !!initial.errors && hasErrors(initial.errors)}
        >
          <Notice tone="error" title="There's a problem" headingLevel={2} announce="off">
            <ul class={styles.errorList}>
              {FEEDBACK_FIELDS.filter((field) => errors[field]).map((field) => (
                <li key={field}>
                  <a
                    href={`#${FIELD_IDS[field]}`}
                    onClick={(e) => {
                      e.preventDefault();
                      focusField(field);
                    }}
                  >
                    {errors[field]}
                  </a>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {submitError && !hasErrors(errors) && (
        <div
          ref={submitErrorRef}
          tabIndex={-1}
          class={`${styles.submitError} ${styles.focusTarget}`}
          autoFocus={attempt === 1 && !!initial.submitError}
        >
          <Notice tone="error" title="Your message wasn't sent" headingLevel={2} announce="off">
            <p class={styles.noticeText}>{submitError}</p>
            {submitError !== RATE_LIMITED_MESSAGE && (
              <p class={styles.noticeText}>
                If it keeps happening, you can <a href="/contact">contact us another way</a>.
              </p>
            )}
          </Notice>
        </div>
      )}

      <form method="post" action={FEEDBACK_PATH} noValidate onSubmit={onSubmit}>
        {loo && <input type="hidden" name={FEEDBACK_LOO_PARAM} value={loo.id} />}

        <div class={styles.field}>
          <label for={FIELD_IDS.text} class={styles.label}>
            Your message
          </label>
          <p id={HINT_IDS.text} class={styles.hint}>
            Tell us what's wrong, what's missing or what we could do better. The Toilet Map team
            reads every message, so please don't include personal details such as your phone number.
          </p>
          {errors.text && (
            <p id={errorId("text")} class={styles.error}>
              <span class={styles.srOnly}>Error: </span>
              {errors.text}
            </p>
          )}
          <TextArea
            ref={fieldRefs.text}
            id={FIELD_IDS.text}
            name="text"
            class={styles.textarea}
            rows={6}
            maxLength={FEEDBACK_TEXT_MAX_LENGTH}
            required
            aria-required="true"
            aria-invalid={errors.text ? true : undefined}
            aria-describedby={describedBy("text")}
            value={text}
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          />
        </div>

        <div class={styles.field}>
          <label for={FIELD_IDS.email} class={styles.label}>
            Email address (optional)
          </label>
          <div id={HINT_IDS.email} class={styles.hint}>
            <p>
              Only if you'd like a reply. We'll use it to reply to this message and nothing else.
            </p>
            <p>
              Only the Toilet Map team can see it: it's never shared or posted to our team chat with
              your message. See our <a href="/privacy">privacy policy</a>.
            </p>
          </div>
          {errors.email && (
            <p id={errorId("email")} class={styles.error}>
              <span class={styles.srOnly}>Error: </span>
              {errors.email}
            </p>
          )}
          <InputField
            ref={fieldRefs.email}
            id={FIELD_IDS.email}
            name="email"
            type="email"
            class={styles.input}
            autoComplete="email"
            inputMode="email"
            spellcheck={false}
            maxLength={FEEDBACK_EMAIL_MAX_LENGTH}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy("email")}
            value={email}
            onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
          />
        </div>

        <div class={styles.actions}>
          <Button
            htmlElement="button"
            type="submit"
            variant="primary"
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            {submitting ? "Sending…" : SUBMIT_LABEL}
          </Button>
          {looHref && (
            <Button htmlElement="a" variant="secondary" href={looHref}>
              Back to the toilet
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
