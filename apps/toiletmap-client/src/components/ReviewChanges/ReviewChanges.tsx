import { useRef } from "preact/hooks";
import { Button } from "toiletmap-design-system";
import type { LooFormMode } from "../LooForm/payload";
import Dialog from "./Dialog";
import type { ReviewItem } from "./describeChanges";
import styles from "./ReviewChanges.module.css";

export interface ReviewChangesProps {
  open: boolean;
  mode: LooFormMode;
  items: ReviewItem[];
  submitting: boolean;
  /** The save succeeded and the page is navigating away: keep the buttons disabled. */
  saved?: boolean;
  /**
   * The user's changes go live straight away (signed in with an unexpired session). Anonymous
   * suggestions are checked by a moderator first; the sheet says which will happen.
   */
  canWriteDirectly: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

const TITLE_ID = "review-changes-title";
const INTRO_ID = "review-changes-intro";

/**
 * The "check your changes" sheet shown before a save: each change in plain language
 * ("Opening hours: Open 24 hours, every day → Mon–Fri 9am–5pm · Sat–Sun closed"), with
 * Back to editing and Confirm and save.
 */
export default function ReviewChanges({
  open,
  mode,
  items,
  submitting,
  saved = false,
  canWriteDirectly,
  onBack,
  onConfirm,
}: ReviewChangesProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = submitting || saved;
  const count = items.length;
  const intro =
    mode === "add"
      ? "Here's what you're adding. Check it looks right."
      : `You're changing ${count} thing${count === 1 ? "" : "s"}:`;

  return (
    <Dialog
      open={open}
      labelledBy={TITLE_ID}
      describedBy={INTRO_ID}
      onDismiss={() => {
        if (!busy) onBack();
      }}
      initialFocus={headingRef}
    >
      <h2 id={TITLE_ID} ref={headingRef} tabIndex={-1} class={styles.title}>
        {mode === "add" ? "Check the new toilet" : "Check your changes"}
      </h2>
      <p id={INTRO_ID} class={styles.intro}>
        {intro}
      </p>
      <ul class={styles.list} aria-label={mode === "add" ? "Details" : "Changes"}>
        {items.map((item) => (
          <li key={item.field} class={styles.item} data-field={item.field}>
            <span class={styles.label}>{item.label}:</span>{" "}
            {item.from !== undefined && (
              <>
                <span class={styles.from}>{item.from}</span> <span aria-hidden="true">→</span>
                <span class={styles.srOnly}> changes to </span>{" "}
              </>
            )}
            <span class={styles.to}>{item.to}</span>
          </li>
        ))}
      </ul>
      <p class={styles.note}>
        {canWriteDirectly
          ? "Your change will go live straight away."
          : "A moderator will check your change before it appears on the map."}
      </p>
      <div class={styles.actions}>
        <Button
          htmlElement="button"
          type="button"
          variant="secondary"
          onClick={onBack}
          disabled={busy}
        >
          Back to editing
        </Button>
        <Button
          htmlElement="button"
          type="button"
          variant="primary"
          onClick={onConfirm}
          disabled={busy}
        >
          {saved ? "Saved" : submitting ? "Saving…" : "Confirm and save"}
        </Button>
      </div>
    </Dialog>
  );
}
