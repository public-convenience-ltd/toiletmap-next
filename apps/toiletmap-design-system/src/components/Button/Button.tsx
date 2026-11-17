import type { ComponentChildren, JSX, Ref } from "preact";
import { forwardRef } from "preact/compat";

// Shared visual props — separate from element-specific attrs
interface ButtonBaseProps {
  variant: "primary" | "secondary";
  children: ComponentChildren;
}

export interface ButtonElementProps
  extends ButtonBaseProps,
    Omit<JSX.IntrinsicElements["button"], "children" | "ref"> {
  htmlElement: "button";
  href?: never;
  ref?: Ref<HTMLButtonElement>;
}

export interface AnchorElementProps
  extends ButtonBaseProps,
    Omit<JSX.IntrinsicElements["a"], "children" | "ref"> {
  htmlElement: "a";
  href: string;
  ref?: Ref<HTMLAnchorElement>;
}

export type ButtonProps = ButtonElementProps | AnchorElementProps;

/** The button classes, plus any `class` / `className` the caller passed. */
const buttonClass = (variant: string, ...extra: unknown[]) =>
  [
    "button",
    variant === "secondary" ? "button--secondary" : "",
    ...extra.filter((c): c is string => typeof c === "string"),
  ]
    .filter(Boolean)
    .join(" ");

const renderButton = (props: ButtonProps, ref: Ref<HTMLButtonElement | HTMLAnchorElement>) => {
  if (props.htmlElement === "a") {
    const { htmlElement: _h, variant, children, class: cls, className, ...rest } = props;
    return (
      <a ref={ref as Ref<HTMLAnchorElement>} class={buttonClass(variant, cls, className)} {...rest}>
        {children}
      </a>
    );
  }

  const { htmlElement: _h, variant, children, class: cls, className, ...rest } = props;
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      class={buttonClass(variant, cls, className)}
      {...rest}
    >
      {children}
    </button>
  );
};

/**
 * The ref is the rendered `<button>` or `<a>`, so callers can move focus to
 * it (e.g. back to the control that opened a panel).
 */
const Button = forwardRef(renderButton as never) as unknown as {
  (props: ButtonProps): JSX.Element;
  displayName?: string;
};

Button.displayName = "Button";
export default Button;
