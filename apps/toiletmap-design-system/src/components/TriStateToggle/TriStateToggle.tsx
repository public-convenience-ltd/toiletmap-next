import "./TriStateToggle.css";

export type TriStateValue = "true" | "false" | "";

const OPTIONS: Array<{ label: string; value: TriStateValue }> = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
  { label: "Unknown", value: "" },
];

export interface TriStateToggleProps {
  name: string;
  label: string;
  value: TriStateValue;
  onChange: (value: TriStateValue) => void;
  hint?: string;
  error?: string;
}

export default function TriStateToggle({
  name,
  label,
  value,
  onChange,
  hint,
  error,
}: TriStateToggleProps) {
  return (
    <fieldset class="tri-state-fieldset" aria-invalid={error ? "true" : "false"}>
      <legend class="tri-state-legend">{label}</legend>
      <div class="tri-state-options">
        {OPTIONS.map((option) => (
          <label key={option.value} class="tri-state-option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              class="tri-state-radio"
            />
            <span class={`tri-state-label${value === option.value ? " tri-state-label--active" : ""}`}>
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {hint && <p class="tri-state-hint">{hint}</p>}
      {error && <span class="tri-state-error">{error}</span>}
    </fieldset>
  );
}
