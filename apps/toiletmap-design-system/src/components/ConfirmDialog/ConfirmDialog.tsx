import type { ComponentChildren, JSX, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import Button from "../Button/Button";
import Icon from "../Icon/Icon";
import IconButton from "../IconButton/IconButton";

export interface ConfirmDialogProps {
  open: boolean;
  /** Names the dialog (aria-labelledby). Ask the question: "Discard your changes?" */
  title: ComponentChildren;
  /** Describes it (aria-describedby): what happens, in a sentence or two. */
  children?: ComponentChildren;
  /** The primary button. Say what it does: "Discard changes", not "OK". */
  confirmLabel: string;
  /** The secondary button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * The primary button. If it returns a promise the dialog is busy until it settles: both
   * buttons are disabled and Escape and the backdrop do nothing. Close the dialog (set
   * `open` to false) when it resolves; if it rejects the buttons come back, so show the
   * error yourself.
   */
  onConfirm: () => unknown;
  /** The secondary button. */
  onCancel: () => void;
  /** Escape, the backdrop and the close button. Defaults to `onCancel`. */
  onDismiss?: () => void;
  /** "destructive" makes the primary button red, for actions that delete or discard. */
  tone?: "default" | "destructive";
  /**
   * What gets focus on open. Defaults to "cancel" for a destructive dialog (the safe choice)
   * and "confirm" otherwise. "title" focuses the heading, for a dialog that is read before it
   * is answered (a list of changes to check), so a second Enter can't confirm it unread.
   */
  initialFocus?: "confirm" | "cancel" | "title" | RefObject<HTMLElement>;
  /** Defaults to true. */
  closeOnEscape?: boolean;
  /** Defaults to true. */
  closeOnBackdrop?: boolean;
  /** Shows a close (×) button that calls `onDismiss`. Defaults to true. */
  showCloseButton?: boolean;
  /** Accessible name of the close button. Defaults to "Close". */
  closeLabel?: string;
  /** Busy from outside (e.g. a save already in flight), as well as while `onConfirm` runs. */
  busy?: boolean;
  /** The primary button's text while busy, e.g. "Saving…". Defaults to `confirmLabel`. */
  busyLabel?: string;
  /** "alertdialog" (the default) for questions that interrupt; "dialog" otherwise. */
  role?: "alertdialog" | "dialog";
  /** Renders into document.body (the default), clear of any transformed or clipped parent. */
  portal?: boolean;
  /** Extra content under the body, above the buttons (e.g. a field or a list). */
  extra?: ComponentChildren;
  id?: string;
  class?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ── Body scroll lock, shared by every open dialog ─────────── */

let lockCount = 0;
let savedStyles: { html: string; body: string; paddingRight: string } | null = null;

function lockScroll() {
  if (typeof document === "undefined") return;
  if (lockCount++ > 0) return;
  const html = document.documentElement;
  const { body } = document;
  // Keep the layout still when the scrollbar disappears.
  const scrollbar = window.innerWidth - html.clientWidth;
  savedStyles = {
    html: html.style.overflow,
    body: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}

function unlockScroll() {
  if (typeof document === "undefined" || lockCount === 0) return;
  if (--lockCount > 0 || !savedStyles) return;
  document.documentElement.style.overflow = savedStyles.html;
  document.body.style.overflow = savedStyles.body;
  document.body.style.paddingRight = savedStyles.paddingRight;
  savedStyles = null;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof (value as PromiseLike<unknown>).then === "function";

/**
 * An "are you sure?" dialog: a title, a sentence of explanation and two buttons.
 *
 * - A centred modal on wide screens; a bottom sheet on narrow or touch screens.
 * - Modal: focus moves in on open and Tab stays inside; the page behind can't scroll; focus
 *   goes back to where it was on close (unless the action moved it somewhere on purpose).
 * - Escape, the backdrop and the × all dismiss (each can be turned off). Keys pressed inside
 *   don't reach the page, so an Escape here doesn't also close a panel behind it.
 * - Primary first in the DOM (and on top when stacked on a phone); on wide screens it sits
 *   on the right, with the secondary to its left.
 */
export default function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  if (props.portal === false || typeof document === "undefined") return <OpenDialog {...props} />;
  return createPortal(<OpenDialog {...props} />, document.body);
}

function OpenDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  onDismiss,
  tone = "default",
  initialFocus,
  closeOnEscape = true,
  closeOnBackdrop = true,
  showCloseButton = true,
  closeLabel = "Close",
  busy = false,
  busyLabel,
  role = "alertdialog",
  extra,
  id,
  class: className,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const isBusy = busy || pending;
  const destructive = tone === "destructive";

  const dismiss = onDismiss ?? onCancel;
  const latest = useRef({ dismiss, isBusy, closeOnEscape });
  latest.current = { dismiss, isBusy, closeOnEscape };

  // Focus in on open, back out on close; lock the page's scroll while open.
  // Runs once per opening (the dialog unmounts when closed); initialFocus is read on open only.
  useLayoutEffect(() => {
    mounted.current = true;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const choice = initialFocus ?? (destructive ? "cancel" : "confirm");
    const target =
      choice === "confirm"
        ? confirmRef.current
        : choice === "cancel"
          ? cancelRef.current
          : choice === "title"
            ? titleRef.current
            : choice.current;
    (target ?? panelRef.current)?.focus();
    lockScroll();

    // Pull focus back if something moves it out of the dialog while it stays open (the
    // backdrop stops clicks on the page behind, but a script can still move it). Checked a
    // tick later: an action that focuses something else and closes the dialog in the same
    // handler ("Move the map") has closed it by then, and keeps its focus.
    let refocus: ReturnType<typeof setTimeout> | undefined;
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || panelRef.current?.contains(event.target)) return;
      clearTimeout(refocus);
      refocus = setTimeout(() => {
        const panel = panelRef.current;
        const active = document.activeElement;
        if (mounted.current && panel && !(active && panel.contains(active))) panel.focus();
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);

    // An Escape pressed while focus is nowhere in the dialog (it fell to the page body) is
    // still the dialog's: handled here first, so it can't reach a handler behind it (the map
    // closing its details panel) while the dialog stays open.
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const root = rootRef.current;
      if (!root || (event.target instanceof Node && root.contains(event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      panelRef.current?.focus();
      if (latest.current.closeOnEscape) requestDismiss();
    };
    document.addEventListener("keydown", onDocumentKeyDown, true);

    return () => {
      mounted.current = false;
      clearTimeout(refocus);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      unlockScroll();
      // Only put focus back if nothing else has claimed it (e.g. "Move the map" focusing the map).
      const active = document.activeElement;
      const focusIsLost =
        !active ||
        active === document.body ||
        !active.isConnected ||
        !!panelRef.current?.contains(active);
      if (focusIsLost && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const confirm = () => {
    if (latest.current.isBusy) return;
    const result = onConfirm();
    if (!isThenable(result)) return;
    setPending(true);
    const done = () => {
      if (mounted.current) setPending(false);
    };
    result.then(done, done);
  };

  const cancel = () => {
    if (latest.current.isBusy) return;
    onCancel();
  };

  const requestDismiss = () => {
    if (latest.current.isBusy) return;
    latest.current.dismiss();
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (latest.current.closeOnEscape) requestDismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === panel)) {
      event.preventDefault();
      first.focus();
    }
  };

  const hasBody = children !== undefined && children !== null && children !== false;

  const panelProps = {
    ref: panelRef,
    class: `confirm-dialog__panel${destructive ? " confirm-dialog__panel--destructive" : ""}`,
    "aria-modal": true,
    "aria-labelledby": titleId,
    "aria-describedby": hasBody ? bodyId : undefined,
    "aria-busy": isBusy || undefined,
    tabIndex: -1,
    onKeyDown,
  } as const;

  const content = (
    <>
      <div class="confirm-dialog__header">
        <h2
          id={titleId}
          ref={titleRef}
          class="confirm-dialog__title"
          tabIndex={initialFocus === "title" ? -1 : undefined}
        >
          {title}
        </h2>
        {showCloseButton && (
          <IconButton
            class="confirm-dialog__close"
            icon="xmark"
            size="medium"
            aria-label={closeLabel}
            aria-disabled={isBusy || undefined}
            onClick={requestDismiss}
          />
        )}
      </div>
      {hasBody && (
        <div id={bodyId} class="confirm-dialog__body">
          {children}
        </div>
      )}
      {extra}
      <div class="confirm-dialog__actions">
        <Button
          htmlElement="button"
          type="button"
          variant={destructive ? "destructive" : "primary"}
          ref={confirmRef}
          class="confirm-dialog__confirm"
          // aria-disabled, not disabled: a disabled button drops the focus it holds.
          aria-disabled={isBusy || undefined}
          onClick={confirm}
        >
          {isBusy && <Icon icon="spinner" spin />}
          {isBusy && busyLabel ? busyLabel : confirmLabel}
        </Button>
        <Button
          htmlElement="button"
          type="button"
          variant="secondary"
          ref={cancelRef}
          class="confirm-dialog__cancel"
          aria-disabled={isBusy || undefined}
          onClick={cancel}
        >
          {cancelLabel}
        </Button>
      </div>
    </>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops keys pressed inside from reaching the page (an Escape here must not also close a panel behind).
    <div
      ref={rootRef}
      id={id}
      class={["confirm-dialog", className].filter(Boolean).join(" ")}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        class="confirm-dialog__backdrop"
        aria-hidden="true"
        // Pressing the backdrop must not take focus out of the dialog (to the page body, where
        // Tab and Escape would go to the page behind), e.g. while it is busy and stays open.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (closeOnBackdrop) requestDismiss();
          const panel = panelRef.current;
          if (mounted.current && panel && !panel.contains(document.activeElement)) panel.focus();
        }}
      />
      {role === "dialog" ? (
        <div role="dialog" {...panelProps}>
          {content}
        </div>
      ) : (
        <div role="alertdialog" {...panelProps}>
          {content}
        </div>
      )}
    </div>
  );
}
