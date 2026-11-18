import type { ComponentChildren, JSX } from "preact";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "error";

interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  children: ComponentChildren;
  /** The status colours Notice and Toast use (`neutral`: navy on light grey). */
  tone?: BadgeTone;
}

/** A short status label: a pill in one of the shared status tones. */
const Badge = ({ children, tone = "neutral", class: className, ...props }: BadgeProps) => (
  <span class={`badge badge--${tone}${className ? ` ${className}` : ""}`} {...props}>
    {children}
  </span>
);

export default Badge;
