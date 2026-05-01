import type { JSX } from "preact";
import type { IconName } from "../Icon/Icon";
import Icon from "../Icon/Icon";

export interface IconButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  "aria-label": string;
  size?: "small" | "medium" | "large" | "x-large";
  variant?: "ghost" | "filled";
}

const IconButton = ({
  icon,
  size = "medium",
  variant = "ghost",
  class: className,
  ...props
}: IconButtonProps) => (
  <button
    type="button"
    class={`icon-button icon-button--${variant}${className ? ` ${className}` : ""}`}
    {...props}
  >
    <Icon icon={icon} size={size} />
  </button>
);

export default IconButton;
