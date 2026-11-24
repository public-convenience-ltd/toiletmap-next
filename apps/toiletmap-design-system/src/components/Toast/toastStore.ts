import type { ComponentChildren } from "preact";
import type { NoticeAction, NoticeTone } from "../Notice/Notice";

/** How long a toast stays up by default, in ms. Paused while it is hovered or focused. */
export const DEFAULT_TOAST_DURATION = 6000;

export interface ToastAction extends NoticeAction {
  /** Dismiss the toast after the action runs. Defaults to true. */
  dismiss?: boolean;
}

export interface ToastOptions {
  message: ComponentChildren;
  title?: ComponentChildren;
  /** Defaults to "success": toasts are for confirmations. */
  tone?: NoticeTone;
  action?: ToastAction;
  /** ms before it dismisses itself; `null` keeps it until the user dismisses it. */
  duration?: number | null;
  /** Showing a toast with the id of one already showing replaces it (its timer restarts). */
  id?: string;
  /** Accessible name of the dismiss button. Defaults to "Dismiss". */
  dismissLabel?: string;
  /** Called once when the toast goes, however it went. */
  onDismiss?: () => void;
}

export interface ToastRecord extends Omit<ToastOptions, "id" | "duration" | "tone"> {
  id: string;
  tone: NoticeTone;
  duration: number | null;
  /** Bumped when the toast is replaced, so its timer restarts. */
  version: number;
}

type Listener = (toasts: readonly ToastRecord[]) => void;

/**
 * A tiny store, so any island or plain module can show a toast without a context provider:
 * Astro islands are separate Preact trees, but they share this module.
 */
export function createToastStore() {
  let toasts: readonly ToastRecord[] = [];
  const listeners = new Set<Listener>();
  let counter = 0;

  const emit = () => {
    for (const listener of listeners) listener(toasts);
  };

  const show = (options: ToastOptions): string => {
    const id = options.id ?? `toast-${++counter}`;
    const existing = toasts.find((t) => t.id === id);
    const record: ToastRecord = {
      ...options,
      id,
      tone: options.tone ?? "success",
      duration: options.duration === undefined ? DEFAULT_TOAST_DURATION : options.duration,
      version: (existing?.version ?? 0) + 1,
    };
    toasts = existing ? toasts.map((t) => (t.id === id ? record : t)) : [...toasts, record];
    emit();
    return id;
  };

  const dismiss = (id: string) => {
    const toast = toasts.find((t) => t.id === id);
    if (!toast) return;
    toasts = toasts.filter((t) => t.id !== id);
    emit();
    toast.onDismiss?.();
  };

  const clear = () => {
    const gone = toasts;
    toasts = [];
    emit();
    for (const toast of gone) toast.onDismiss?.();
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { show, dismiss, clear, subscribe, getAll: () => toasts };
}

export type ToastStore = ReturnType<typeof createToastStore>;

/** The page's toasts. Render one `<ToastRegion />` to show them. */
export const toast: ToastStore = createToastStore();
