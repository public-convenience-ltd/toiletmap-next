import type { ComponentChildren, JSX } from "preact";

interface DrawerProps {
  children: ComponentChildren;
  visible: boolean;
  animateFrom: "right" | "left";
  /**
   * Distance in px from the top of the viewport to the drawer's top edge,
   * e.g. the bottom of the header that opened it. Defaults to the
   * `--header-height` custom property (set by `Header`), or 0.
   */
  offsetTop?: number;
  id?: string;
}

const Drawer = ({ children, visible, animateFrom, offsetTop, id }: DrawerProps) => (
  <div
    id={id}
    class={`drawer drawer--from-${animateFrom}${visible ? " drawer--visible" : ""}`}
    style={
      offsetTop === undefined
        ? undefined
        : ({ "--drawer-top": `${Math.max(0, Math.round(offsetTop))}px` } as JSX.CSSProperties)
    }
  >
    {children}
  </div>
);

export default Drawer;
