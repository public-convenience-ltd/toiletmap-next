import type { JSX } from "preact";
import { forwardRef } from "preact/compat";
import type { IconName } from "../Icon/Icon";
import Icon from "../Icon/Icon";

export interface IconButtonProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "ref"> {
  icon: IconName;
  "aria-label": string;
  size?: "small" | "medium" | "large" | "x-large";
  variant?: "ghost" | "filled";
}

/** The ref is the underlying `<button>`, so callers can move focus to it. */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = "medium", variant = "ghost", class: cls, className, ...props }, ref) => (
    <button
      type="button"
      ref={ref}
      class={["icon-button", `icon-button--${variant}`, cls, className]
        .filter((c): c is string => typeof c === "string" && c !== "")
        .join(" ")}
      {...props}
    >
      <Icon icon={icon} size={size} />
    </button>
  ),
);

IconButton.displayName = "IconButton";
export default IconButton;
