import type { ComponentChildren, JSX } from "preact";

type ProseElement = "div" | "article" | "section";

export interface ProseProps {
  children?: ComponentChildren;
  /** The wrapping element. Defaults to `div`. */
  as?: ProseElement;
  /** Extra classes, after `prose`. */
  class?: string;
  id?: string;
  /** Rendered HTML (e.g. from Markdown) instead of children. Only pass trusted HTML. */
  dangerouslySetInnerHTML?: JSX.HTMLAttributes["dangerouslySetInnerHTML"];
}

/**
 * Long-form text: headings, lists, links, quotes, tables, images and code, in a readable
 * column (about 70 characters). Styles bare elements, so Markdown and CMS output need no
 * classes. Astro pages can use the same styles with `<div class="prose">`.
 */
const Prose = ({ as: Tag = "div", class: className, children, ...props }: ProseProps) => (
  <Tag class={className ? `prose ${className}` : "prose"} {...props}>
    {children}
  </Tag>
);

export default Prose;
