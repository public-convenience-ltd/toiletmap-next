import type { JSX } from "preact";
import { forwardRef } from "preact/compat";

const TextArea = forwardRef<HTMLTextAreaElement, JSX.IntrinsicElements["textarea"]>(
  ({ class: className, ...props }, ref) => (
    <textarea class={`text-area${className ? ` ${className}` : ""}`} ref={ref} {...props} />
  ),
);

TextArea.displayName = "TextArea";
export default TextArea;
