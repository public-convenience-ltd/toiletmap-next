import type { ComponentChildren, JSX } from "preact";

interface DrawerProps {
  children: ComponentChildren;
  visible: boolean;
  animateFrom: "right" | "left";
}

const Drawer = ({ children, visible, animateFrom }: DrawerProps) => {
  const animateTo = animateFrom === "right" ? "left" : "right";

  return (
    <div
      class="drawer"
      style={
        {
          transition: `0.3s ${animateTo} ease-in-out, 0.3s visibility ease-in-out`,
          [animateTo]: visible ? "0%" : "100%",
          visibility: visible ? "visible" : "hidden",
        } as JSX.CSSProperties
      }
    >
      {children}
    </div>
  );
};

export default Drawer;
