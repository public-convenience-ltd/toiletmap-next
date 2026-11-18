import "./BottomSheet.css";
import type { ComponentChildren, JSX, Ref } from "preact";
import { useId, useRef, useState } from "preact/hooks";

export type BottomSheetState = "peek" | "expanded";

export interface BottomSheetProps {
  /** Peek shows whatever the content is at rest (e.g. a summary); expanded is capped and scrolls. */
  state: BottomSheetState;
  onStateChange: (state: BottomSheetState) => void;
  /**
   * Escape at peek, or dragging the handle down at peek. Without it the sheet can only be
   * collapsed, never dismissed, from inside.
   */
  onDismiss?: () => void;
  children: ComponentChildren;
  /** Names the region (the id of the sheet's heading). Prefer this over `aria-label`. */
  "aria-labelledby"?: string;
  "aria-label"?: string;
  /** Accessible name of the drag handle; its state is announced through aria-expanded. */
  handleLabel?: string;
  /** The id of the content the handle expands (aria-controls). Defaults to the sheet's body. */
  controls?: string;
  class?: string;
  /** Extra inline style, e.g. `--bottom-sheet-max-height`. */
  style?: JSX.CSSProperties;
  sheetRef?: Ref<HTMLElement>;
  /** Called with every keydown inside the sheet before its own Escape handling. */
  onKeyDown?: (event: KeyboardEvent) => void;
}

/** Drags shorter than this are taps (the click toggles instead). */
const DRAG_SLOP_PX = 8;
/** A drag this far snaps to the next state. */
const SNAP_PX = 48;
/** How far an upward drag at the top state moves before it resists. */
const OVERDRAG_PX = 24;

/**
 * A non-modal bottom sheet with two states, peek and expanded.
 *
 * - It's a `role="region"`, not a dialog: no backdrop, no focus trap, and the page behind it
 *   stays usable.
 * - Height follows the content, capped at `--bottom-sheet-max-height` (60% of the positioned
 *   container by default); the body scrolls inside.
 * - The handle is a button: a tap toggles, a vertical drag snaps (up expands; down collapses,
 *   then dismisses).
 * - Escape collapses expanded → peek, then calls `onDismiss`.
 * - The handle is drawn 20px tall, with a --tap-min hit area reaching up over the map.
 * - Pads the bottom by the larger of `--bottom-sheet-padding-bottom` (--space-s) and
 *   `--safe-bottom` (the safe-area inset), and skips animation under
 *   prefers-reduced-motion.
 *
 * Place it inside a `position: relative | absolute` container: it pins to that container's
 * bottom edge.
 */
export default function BottomSheet({
  state,
  onStateChange,
  onDismiss,
  children,
  "aria-labelledby": labelledBy,
  "aria-label": label,
  handleLabel = "Resize",
  controls,
  class: className,
  style,
  sheetRef,
  onKeyDown,
}: BottomSheetProps) {
  const bodyId = useId();
  const expanded = state === "expanded";
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; startY: number; moved: boolean } | null>(null);
  /** Set when a drag ended, so the click that follows it doesn't toggle too. */
  const suppressClick = useRef(false);

  const toggle = () => onStateChange(expanded ? "peek" : "expanded");

  const onHandleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    toggle();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, moved: false };
    suppressClick.current = false;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.abs(dy) < DRAG_SLOP_PX) return;
    current.moved = true;
    // Follow the finger downwards; upwards only a little (the content sets the height).
    setDragOffset(dy < 0 ? Math.max(dy, -OVERDRAG_PX) : dy);
  };

  const endDrag = (event: PointerEvent, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragOffset(null);
    if (!current.moved) return;
    suppressClick.current = true;
    if (cancelled) return;
    const dy = event.clientY - current.startY;
    if (dy <= -SNAP_PX && !expanded) onStateChange("expanded");
    else if (dy >= SNAP_PX) {
      if (expanded) onStateChange("peek");
      else onDismiss?.();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    onKeyDown?.(event);
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (expanded) onStateChange("peek");
    else if (onDismiss) onDismiss();
    else return;
    event.preventDefault();
    // Handled here: keep page-level Escape handlers (which may close everything) out of it.
    event.stopPropagation();
  };

  const classes = [
    "bottom-sheet",
    `bottom-sheet--${state}`,
    dragOffset !== null ? "bottom-sheet--dragging" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={sheetRef as Ref<HTMLElement>}
      class={classes}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      data-state={state}
      style={{
        ...style,
        ...(dragOffset !== null ? { transform: `translateY(${dragOffset}px)` } : {}),
      }}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        class="bottom-sheet__handle"
        aria-label={handleLabel}
        aria-expanded={expanded}
        aria-controls={controls ?? bodyId}
        onClick={onHandleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
      >
        <span class="bottom-sheet__grip" aria-hidden="true" />
      </button>
      <div class="bottom-sheet__body" id={bodyId}>
        {children}
      </div>
    </section>
  );
}
