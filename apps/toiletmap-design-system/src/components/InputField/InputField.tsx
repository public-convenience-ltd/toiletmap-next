import type { JSX } from "preact";
import { forwardRef } from "preact/compat";

const InputField = forwardRef<HTMLInputElement, JSX.IntrinsicElements["input"]>(
  ({ class: className, ...props }, ref) => (
    <input ref={ref} class={`input${className ? ` ${className}` : ""}`} {...props} />
  ),
);

InputField.displayName = "InputField";
export default InputField;
