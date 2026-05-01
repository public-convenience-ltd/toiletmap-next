import type { ComponentChildren, JSX } from "preact";

interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  children: ComponentChildren;
}

const Badge = ({ children, class: className, ...props }: BadgeProps) => (
  <span class={`badge${className ? ` ${className}` : ""}`} {...props}>
    {children}
  </span>
);

export default Badge;
