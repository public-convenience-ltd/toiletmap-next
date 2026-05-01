import type { JSX } from "preact";
import { forwardRef } from "preact/compat";

interface SwitchProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "onClick" | "onChange"> {
  checked: boolean;
  onClick?: () => void;
  onChange?: (checked: boolean) => void;
}

const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onClick, onChange, ...props }, ref) => (
    <button
      type="button"
      role="switch"
      ref={ref}
      {...props}
      class="switch"
      aria-checked={checked}
      onClick={() => {
        onClick?.();
        onChange?.(!checked);
      }}
    >
      <span class="switch-thumb" />
    </button>
  ),
);

Switch.displayName = "Switch";
export default Switch;
