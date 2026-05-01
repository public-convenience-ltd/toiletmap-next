import type { JSX } from "preact";
import { forwardRef } from "preact/compat";

const TextArea = forwardRef<HTMLTextAreaElement, JSX.HTMLAttributes<HTMLTextAreaElement>>(
  (props, ref) => <textarea class="text-area" ref={ref} {...props} />,
);

TextArea.displayName = "TextArea";
export default TextArea;
