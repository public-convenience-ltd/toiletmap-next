import type { ComponentChildren } from "preact";

type As = "span" | "div" | "caption";

interface VisuallyHiddenProps {
  children: ComponentChildren;
  as?: As;
  id?: string;
  class?: string;
}

const VisuallyHidden = ({ children, as: Tag = "div", ...props }: VisuallyHiddenProps) => (
  <Tag class="visually-hidden" {...props}>
    {children}
  </Tag>
);

export default VisuallyHidden;
