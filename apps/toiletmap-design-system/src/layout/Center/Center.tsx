import type { ComponentChildren } from "preact";

type CenterProps = {
  children: ComponentChildren;
  text?: boolean;
  gutter?: boolean;
  article?: boolean;
};

const Center = ({ text, gutter, article, children }: CenterProps) => {
  const centerClass =
    "center" +
    (text ? " center--text" : "") +
    (gutter ? " center--gutter" : "") +
    (article ? " center--article" : "");

  return <div class={centerClass}>{children}</div>;
};

export default Center;
