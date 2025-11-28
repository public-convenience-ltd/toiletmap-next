import type { JSX as HonoJSX } from "hono/jsx";

declare global {
  namespace JSX {
    // Re-export Hono's JSX definitions so TSX files can use intrinsic elements.
    type Element = HonoJSX.Element;
    interface ElementChildrenAttribute
      extends HonoJSX.ElementChildrenAttribute {}
    interface IntrinsicElements extends HonoJSX.IntrinsicElements {}
    interface IntrinsicAttributes extends HonoJSX.IntrinsicAttributes {}
  }
}

export {};
