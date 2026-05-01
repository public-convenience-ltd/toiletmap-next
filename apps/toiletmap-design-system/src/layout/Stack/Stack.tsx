import type { ComponentChildren } from "preact";

type StackProps = {
  children: ComponentChildren;
  direction?: "row" | "column";
  space?: "3xs" | "2xs" | "xs" | "s" | "m" | "l" | "xl" | "2xl" | "3xl";
};

const Stack = ({ space = "s", direction = "column", children }: StackProps) => (
  <div class={`stack stack--${space} stack--${direction}`}>{children}</div>
);

export default Stack;
