import type { ComponentChildren, JSX } from "preact";

export interface TagProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "children"> {
  active?: boolean;
  children: ComponentChildren;
}

const Tag = ({ active, children, class: className, ...props }: TagProps) => (
  <button
    type="button"
    class={`tag${active ? " tag--active" : ""}${className ? ` ${className}` : ""}`}
    aria-pressed={active}
    {...props}
  >
    {children}
  </button>
);

export default Tag;
