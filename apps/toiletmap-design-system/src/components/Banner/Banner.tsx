import type { ComponentChildren } from "preact";
import Notice, { type NoticeTone } from "../Notice/Notice";

export type BannerVariant = NoticeTone;

interface BannerProps {
  variant?: BannerVariant;
  title?: string;
  children: ComponentChildren;
}

/**
 * @deprecated Use `Notice`. Kept so existing callers keep working while they migrate.
 *
 * Renders a `Notice` with Banner's old semantics: the title is an `<h2>`, errors and
 * warnings are `role="alert"`, and info and success have no live role. It keeps the
 * `banner` / `banner--{variant}` classes for callers that target them.
 */
const Banner = ({ variant = "info", title, children }: BannerProps) => (
  <Notice
    tone={variant}
    title={title}
    headingLevel={title ? 2 : undefined}
    announce={variant === "error" || variant === "warning" ? "assertive" : "off"}
    class={`banner banner--${variant}`}
  >
    {children}
  </Notice>
);

export default Banner;
