import type { JSX } from "preact";

export type IconName =
  | "asterisk"
  | "comments"
  | "bars"
  | "filter"
  | "angle-right"
  | "circle-plus"
  | "map-location-dot"
  | "spinner"
  | "diamond-turn-right"
  | "xmark"
  | "note-sticky"
  | "plus"
  | "minus"
  | "pen-to-square"
  | "chevron-down"
  | "circle-xmark"
  | "clock"
  | "list"
  | "question"
  | "check"
  | "person-dress"
  | "person"
  | "wheelchair-move"
  | "key"
  | "toilet"
  | "sterling-sign"
  | "child"
  | "baby"
  | "gear"
  | "bluesky"
  | "share"
  | "magnifying-glass"
  | "patreon"
  | "info"
  | "warning"
  | "success";

export interface IconProps {
  icon: IconName;
  size?: "small" | "medium" | "large" | "x-large";
  spin?: boolean;
  class?: string;
  style?: JSX.CSSProperties | string;
  /** Accessible label — when provided, icon gets role="img" and a <title> instead of aria-hidden */
  "aria-label"?: string;
}

const Icon = ({
  icon,
  size,
  spin,
  "aria-label": ariaLabel,
  class: extraClass,
  ...props
}: IconProps) => {
  const sizeClass = size ?? "small";
  const spinClass = spin ? " spin" : "";
  const svgClass = sizeClass + spinClass;
  const spanClass = extraClass ? `icon ${extraClass}` : "icon";
  const useHref = `/sprites/solid.svg#${icon}`;

  if (ariaLabel) {
    return (
      <span class={spanClass} {...props}>
        <svg fill="currentColor" class={svgClass} role="img" aria-label={ariaLabel}>
          <title>{ariaLabel}</title>
          <use href={useHref} />
        </svg>
      </span>
    );
  }

  return (
    <span class={spanClass} {...props}>
      <svg fill="currentColor" class={svgClass} aria-hidden="true">
        <title>icon</title>
        <use href={useHref} />
      </svg>
    </span>
  );
};

export default Icon;
