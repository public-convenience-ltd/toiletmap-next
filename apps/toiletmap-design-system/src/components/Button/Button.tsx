import type { ComponentChildren, JSX } from "preact";

// Shared visual props — separate from element-specific attrs
interface ButtonBaseProps {
  variant: "primary" | "secondary";
  children: ComponentChildren;
}

export interface ButtonElementProps
  extends ButtonBaseProps,
    Omit<JSX.HTMLAttributes<HTMLButtonElement>, "children"> {
  htmlElement: "button";
  href?: never;
}

export interface AnchorElementProps
  extends ButtonBaseProps,
    Omit<JSX.HTMLAttributes<HTMLAnchorElement>, "children"> {
  htmlElement: "a";
  href: string;
}

export type ButtonProps = ButtonElementProps | AnchorElementProps;

const buttonClass = (variant: string) =>
  `button${variant === "secondary" ? " button--secondary" : ""}`;

const Button = (props: ButtonProps) => {
  if (props.htmlElement === "a") {
    const { htmlElement: _h, variant, children, ...rest } = props;
    return (
      <a class={buttonClass(variant)} {...rest}>
        {children}
      </a>
    );
  }

  const { htmlElement: _h, variant, children, ...rest } = props;
  return (
    <button class={buttonClass(variant)} {...rest}>
      {children}
    </button>
  );
};

Button.displayName = "Button";
export default Button;
