import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import styles from "./ReviewChanges.module.css";

export interface DialogProps {
  open: boolean;
  /** id of the element that names the dialog (usually its heading). */
  labelledBy: string;
  describedBy?: string;
  /** Escape, or a click on the backdrop. */
  onDismiss: () => void;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: "dialog" | "alertdialog";
  /**
   * What to focus on open: an element ref, or a CSS selector matched inside the dialog.
   * Defaults to the dialog itself.
   */
  initialFocus?: RefObject<HTMLElement> | string;
  children: ComponentChildren;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet rendered in the page (no native <dialog>, so it behaves the same in every
 * browser and in tests). Moves focus in on open, keeps Tab inside, closes on Escape and
 * puts focus back where it was on close.
 */
export default function Dialog({
  open,
  labelledBy,
  describedBy,
  onDismiss,
  role = "dialog",
  initialFocus,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const target =
      typeof initialFocus === "string"
        ? panel?.querySelector<HTMLElement>(initialFocus)
        : initialFocus?.current;
    (target ?? panel)?.focus();

    return () => {
      // Only restore focus if nothing else has claimed it since (e.g. an error summary).
      const active = document.activeElement;
      const focusIsLost =
        !active || active === document.body || !!panelRef.current?.contains(active);
      if (focusIsLost && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div class={styles.layer}>
      <div class={styles.backdrop} aria-hidden="true" onClick={() => dismissRef.current()} />
      {role === "alertdialog" ? (
        <div
          ref={panelRef}
          class={styles.sheet}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {children}
        </div>
      ) : (
        <div
          ref={panelRef}
          class={styles.sheet}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {children}
        </div>
      )}
    </div>
  );
}
