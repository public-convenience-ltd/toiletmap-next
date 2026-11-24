import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import Notice, { type NoticeTone } from "../Notice/Notice";
import {
  DEFAULT_TOAST_DURATION,
  toast as defaultStore,
  type ToastAction,
  type ToastRecord,
  type ToastStore,
} from "./toastStore";

export interface ToastProps {
  message: ComponentChildren;
  title?: ComponentChildren;
  /** Defaults to "success". */
  tone?: NoticeTone;
  action?: ToastAction;
  /** ms before `onDismiss` is called by itself; `null` never. Defaults to 6000. */
  duration?: number | null;
  dismissLabel?: string;
  onDismiss: () => void;
  /** Restarts the timer when it changes (the region passes the toast's version). */
  timerKey?: unknown;
}

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * One toast. Use `toast.show()` and a `ToastRegion` rather than rendering this yourself: the
 * region is the live region that announces it. On its own a Toast is not announced.
 *
 * Its timer pauses while the pointer is over it, while focus is inside it, and while the
 * page is hidden, then carries on with the time that was left. Escape dismisses it.
 */
export function Toast({
  message,
  title,
  tone = "success",
  action,
  duration = DEFAULT_TOAST_DURATION,
  dismissLabel,
  onDismiss,
  timerKey,
}: ToastProps) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const hovered = useRef(false);
  const focused = useRef(false);
  const timer = useRef<{
    remaining: number;
    startedAt: number;
    handle?: ReturnType<typeof setTimeout>;
  } | null>(null);

  const pause = () => {
    const t = timer.current;
    if (!t || t.handle === undefined) return;
    clearTimeout(t.handle);
    t.handle = undefined;
    t.remaining -= Date.now() - t.startedAt;
  };

  const resume = () => {
    const t = timer.current;
    if (!t || t.handle !== undefined) return;
    if (hovered.current || focused.current || isHidden()) return;
    t.startedAt = Date.now();
    t.handle = setTimeout(() => dismissRef.current(), Math.max(0, t.remaining));
  };

  // timerKey restarts the timer on purpose; pause and resume only touch refs.
  useEffect(() => {
    if (duration === null || !Number.isFinite(duration)) {
      timer.current = null;
      return;
    }
    timer.current = { remaining: duration, startedAt: 0 };
    resume();
    const onVisibility = () => (isHidden() ? pause() : resume());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      pause();
      timer.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [duration, timerKey]);

  const onFocusOut = (event: JSX.TargetedFocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    focused.current = false;
    resume();
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    dismissRef.current();
  };

  const noticeAction = action && {
    label: action.label,
    href: action.href,
    onClick: (event: MouseEvent) => {
      action.onClick?.(event);
      if (action.dismiss !== false) dismissRef.current();
    },
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pauses the timer and handles Escape for the controls inside; the element itself is not interactive.
    <div
      class="toast"
      onMouseEnter={() => {
        hovered.current = true;
        pause();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        resume();
      }}
      onFocusIn={() => {
        focused.current = true;
        pause();
      }}
      onFocusOut={onFocusOut}
      onKeyDown={onKeyDown}
    >
      <Notice
        tone={tone}
        title={title}
        size="compact"
        // The region is the live region; a role here would announce it twice.
        announce="off"
        action={noticeAction}
        onDismiss={() => dismissRef.current()}
        dismissLabel={dismissLabel}
      >
        {message}
      </Notice>
    </div>
  );
}

export interface ToastRegionProps {
  /** Defaults to the shared `toast` store. */
  store?: ToastStore;
  /** Which edge of the screen the toasts sit against. Defaults to "bottom". */
  placement?: "bottom" | "top";
  /**
   * Extra distance from that edge, on top of the safe-area inset: e.g. the height of an open
   * bottom sheet, so toasts sit above it. A number is px. You can also set `--toast-offset`
   * in CSS. With `placement="top"` it defaults to the header's `--header-height`.
   */
  offset?: number | string;
  /** The most toasts shown at once (the newest). Defaults to 3. */
  max?: number;
  /** Accessible name of the list of toasts. Defaults to "Notifications". */
  label?: string;
  class?: string;
}

/**
 * Where toasts appear. Render one per page, early (it must already be on the page when a
 * toast is added, or screen readers miss it), e.g. next to the map.
 *
 * It is a polite live region (`aria-live="polite"`) that is always rendered, even empty. It
 * pins to the viewport, clear of notches and the home indicator, and lets clicks through
 * everywhere except on the toasts themselves.
 */
export function ToastRegion({
  store = defaultStore,
  placement = "bottom",
  offset,
  max = 3,
  label = "Notifications",
  class: className,
}: ToastRegionProps) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>(store.getAll());

  useEffect(() => {
    setToasts(store.getAll());
    return store.subscribe(setToasts);
  }, [store]);

  const style =
    offset === undefined
      ? undefined
      : ({
          "--toast-offset": typeof offset === "number" ? `${offset}px` : offset,
        } as JSX.CSSProperties);

  return (
    <div
      class={["toast-region", `toast-region--${placement}`, className].filter(Boolean).join(" ")}
      style={style}
    >
      <ol
        class="toast-region__list"
        aria-label={label}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {toasts.slice(-Math.max(1, max)).map((record) => (
          <li key={record.id} class="toast-region__item">
            <Toast
              message={record.message}
              title={record.title}
              tone={record.tone}
              action={record.action}
              duration={record.duration}
              dismissLabel={record.dismissLabel}
              timerKey={record.version}
              onDismiss={() => store.dismiss(record.id)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

export default Toast;
