import type { ComponentChildren, JSX } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import Button from "../Button/Button";
import Icon, { type IconName } from "../Icon/Icon";
import IconButton from "../IconButton/IconButton";

export type NoticeTone = "info" | "success" | "warning" | "error";

/** A single follow-up action: a button (`onClick`) or a link (`href`). */
export interface NoticeAction {
  label: string;
  onClick?: (event: MouseEvent) => void;
  href?: string;
}

/**
 * How the notice is announced when it appears or changes:
 * - "polite": `role="status"` (read when the screen reader is idle);
 * - "assertive": `role="alert"` (interrupts);
 * - "off": no live role, e.g. a notice that is there when the page loads, or one inside
 *   a region that is already live (a Toast).
 */
export type NoticeAnnounce = "polite" | "assertive" | "off";

export interface NoticeProps {
  tone?: NoticeTone;
  /** A short summary in bold above the body. */
  title?: ComponentChildren;
  /**
   * Renders the title as a heading of this level (e.g. 2 for a page-level message). Without
   * it the title is a bold paragraph, which keeps the page's heading outline clean.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  children?: ComponentChildren;
  /** One follow-up action, shown as a secondary button under the body. */
  action?: NoticeAction;
  /** Any other controls for the action row (rendered after `action`). */
  actions?: ComponentChildren;
  /** Shows a dismiss (×) button that calls this. */
  onDismiss?: () => void;
  /** Accessible name of the dismiss button. Defaults to "Dismiss". */
  dismissLabel?: string;
  /** Defaults to "assertive" for errors and "polite" for every other tone. */
  announce?: NoticeAnnounce;
  /**
   * Moves keyboard focus to the notice when it mounts (e.g. an error summary after a failed
   * submit). A focused notice is never also a live region, so it is read once, not twice:
   * `announce` is ignored and the notice becomes a labelled group.
   */
  autoFocus?: boolean;
  /** "compact" is smaller and tighter, for notices inside panels and cards. */
  size?: "default" | "compact";
  /** Replaces the tone's icon; `false` hides it. */
  icon?: IconName | false;
  id?: string;
  class?: string;
  style?: JSX.CSSProperties | string;
}

const TONE_ICONS: Record<NoticeTone, IconName> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "circle-xmark",
};

const ROLES: Record<Exclude<NoticeAnnounce, "off">, "status" | "alert"> = {
  polite: "status",
  assertive: "alert",
};

/**
 * An inline message: info, success, warning or error.
 *
 * Every tone has the same layout (icon, optional title, body, optional actions and dismiss)
 * and takes its colours from the `--color-{tone}-*` tokens, all AA against the background.
 * Screen readers only announce a live region whose content changes, so render a polite
 * notice into a container that is already on the page when the message should be read out.
 */
export default function Notice({
  tone = "info",
  title,
  headingLevel,
  children,
  action,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  announce,
  autoFocus = false,
  size = "default",
  icon,
  id,
  class: className,
  style,
}: NoticeProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const live = autoFocus ? "off" : (announce ?? (tone === "error" ? "assertive" : "polite"));
  const role = autoFocus ? "group" : live === "off" ? undefined : ROLES[live];
  const iconName = icon === undefined ? TONE_ICONS[tone] : icon;
  const hasTitle = title !== undefined && title !== null && title !== "";
  const TitleTag = headingLevel ? (`h${headingLevel}` as const) : "p";
  const hasActions = !!action || (actions !== undefined && actions !== null && actions !== false);

  const classes = [
    "notice",
    `notice--${tone}`,
    size === "compact" ? "notice--compact" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-labelledby is only set with role="group" (autoFocus).
    <div
      ref={ref}
      id={id}
      class={classes}
      style={style}
      role={role}
      aria-labelledby={autoFocus && hasTitle ? titleId : undefined}
      tabIndex={autoFocus ? -1 : undefined}
    >
      {iconName && (
        <span class="notice__icon">
          <Icon icon={iconName} size={size === "compact" ? "medium" : "large"} />
        </span>
      )}
      <div class="notice__body">
        {hasTitle && (
          <TitleTag id={titleId} class="notice__title">
            {title}
          </TitleTag>
        )}
        {children !== undefined && children !== null && (
          <div class="notice__content">{children}</div>
        )}
        {hasActions && (
          <div class="notice__actions">
            {action &&
              (action.href ? (
                <Button
                  htmlElement="a"
                  variant="secondary"
                  href={action.href}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ) : (
                <Button
                  htmlElement="button"
                  type="button"
                  variant="secondary"
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            {actions}
          </div>
        )}
      </div>
      {onDismiss && (
        <IconButton
          class="notice__dismiss"
          icon="xmark"
          size="medium"
          aria-label={dismissLabel}
          onClick={onDismiss}
        />
      )}
    </div>
  );
}
