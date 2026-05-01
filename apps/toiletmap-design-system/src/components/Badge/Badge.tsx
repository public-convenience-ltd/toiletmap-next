import type { ComponentChildren, JSX } from "preact";

interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  children: ComponentChildren;
}

const Badge = ({ children, ...props }: BadgeProps) => (
  <span class="badge" {...props}>
    {children}
  </span>
);

export default Badge;
