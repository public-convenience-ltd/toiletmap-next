import { ConfirmDialog } from "toiletmap-design-system";
import type { LooFormMode } from "../LooForm/payload";
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
   * suggestions are checked by a moderator first; the sheet says which will happen, and its
   * button says "Send for review" rather than "Confirm and save".
   */
  canWriteDirectly: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

/** The primary button for someone whose change is checked by a moderator first. */
export const SEND_FOR_REVIEW_LABEL = "Send for review";
/** The primary button for someone whose change goes live straight away. */
export const CONFIRM_AND_SAVE_LABEL = "Confirm and save";

/**
 * The "check your changes" sheet shown before a save: each change in plain language
 * ("Opening hours: Open 24 hours, every day → Mon–Fri 9am–5pm · Sat–Sun closed"), with
 * Back to editing and Confirm and save (or Send for review).
 *
 * A DS ConfirmDialog (a bottom sheet on phones, a centred dialog on wide screens), so it
 * shares focus, Escape and backdrop handling with every other confirmation. Focus starts on
 * its heading: the list is read before it is confirmed, and a second Enter on the form's
 * Save button can't save unread.
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
  const busy = submitting || saved;
  const count = items.length;
  const intro =
    mode === "add"
      ? "Here's what you're adding. Check it looks right."
      : `You're changing ${count} thing${count === 1 ? "" : "s"}:`;
  const note =
    mode === "add"
      ? canWriteDirectly
        ? "The toilet will go on the map straight away."
        : "A moderator will check the new toilet before it appears on the map."
      : canWriteDirectly
        ? "Your change will go live straight away."
        : "A moderator will check your change before it appears on the map.";

  return (
    <ConfirmDialog
      open={open}
      role="dialog"
      class={styles.review}
      title={mode === "add" ? "Check the new toilet" : "Check your changes"}
      initialFocus="title"
      confirmLabel={canWriteDirectly ? CONFIRM_AND_SAVE_LABEL : SEND_FOR_REVIEW_LABEL}
      cancelLabel="Back to editing"
      busy={busy}
      busyLabel={saved ? "Saved" : "Saving…"}
      onConfirm={onConfirm}
      onCancel={onBack}
      extra={
        <>
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
          <p class={styles.note}>{note}</p>
        </>
      }
    >
      <p>{intro}</p>
    </ConfirmDialog>
  );
}
