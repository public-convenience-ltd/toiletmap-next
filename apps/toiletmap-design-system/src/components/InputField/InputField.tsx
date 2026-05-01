import type { JSX } from "preact";
import { forwardRef } from "preact/compat";

const InputField = forwardRef<HTMLInputElement, JSX.HTMLAttributes<HTMLInputElement>>(
  (props, ref) => <input ref={ref} class="input" {...props} />,
);

InputField.displayName = "InputField";
export default InputField;
