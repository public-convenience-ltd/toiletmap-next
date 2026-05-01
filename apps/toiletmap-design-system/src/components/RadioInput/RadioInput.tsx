import type { JSX } from "preact";
import { forwardRef } from "preact/compat";

const RadioInput = forwardRef<HTMLInputElement, JSX.HTMLAttributes<HTMLInputElement>>(
  function RadioInput(props, ref) {
    return (
      <label>
        <input type="radio" class="radio-input" ref={ref} {...props} />
        <span />
      </label>
    );
  },
);

RadioInput.displayName = "RadioInput";
export default RadioInput;
