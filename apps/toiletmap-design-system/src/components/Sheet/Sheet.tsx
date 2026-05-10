import type { ComponentChildren } from "preact";

export interface SheetProps {
  children: ComponentChildren;
  visible: boolean;
  side: "bottom" | "left" | "right";
  /** Clicking the backdrop calls this — also closes the sheet */
  onClose?: () => void;
  /** Show semi-transparent backdrop (default true) */
  overlay?: boolean;
  /** CSS z-index for the panel; overlay sits at zIndex - 1 */
  zIndex?: number;
}

const Sheet = ({ children, visible, side, onClose, overlay = true, zIndex = 1500 }: SheetProps) => (
  <>
    {overlay && (
      <div
        class={`sheet__overlay${visible ? " sheet__overlay--visible" : ""}`}
        style={{ zIndex: zIndex - 1 }}
        onClick={onClose}
        aria-hidden="true"
      />
    )}
    <div
      class={`sheet sheet--${side}${visible ? " sheet--visible" : ""}`}
      style={{ zIndex }}
      role="dialog"
      aria-modal={visible || undefined}
    >
      {children}
    </div>
  </>
);

export default Sheet;
