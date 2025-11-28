/** @jsxImportSource hono/jsx/dom */

import type { LooFormState, TriStateValue } from '../utils/types';

const OPTIONS: Array<{ label: string; value: TriStateValue }> = [
    { label: 'Yes', value: 'true' },
    { label: 'No', value: 'false' },
    { label: 'Unknown', value: '' },
];

type TriStateFieldProps = {
    label: string;
    name: keyof Pick<
        LooFormState,
        | 'accessible'
        | 'radar'
        | 'attended'
        | 'automatic'
        | 'noPayment'
        | 'babyChange'
        | 'men'
        | 'women'
        | 'allGender'
        | 'children'
        | 'urinalOnly'
        | 'active'
    >;
    value: TriStateValue;
    onChange: (field: keyof LooFormState, value: TriStateValue) => void;
    error?: string;
    hint?: string;
    compact?: boolean;
};

export const TriStateField = ({ label, name, value, onChange, error, hint, compact }: TriStateFieldProps) => (
    <fieldset class={`tri-field ${compact ? 'tri-field--compact' : ''}`} aria-invalid={error ? 'true' : 'false'}>
        <legend class="form-label">{label}</legend>
        <div class="tri-state-container">
            {OPTIONS.map((option) => (
                <label class="tri-state-option">
                    <input
                        type="radio"
                        name={name}
                        value={option.value}
                        checked={value === option.value}
                        onChange={() => onChange(name, option.value)}
                    />
                    <span
                        class={`tri-state-label ${value === option.value ? 'tri-state-label--active' : ''}`}
                        aria-pressed={value === option.value ? 'true' : 'false'}
                    >
                        {option.label}
                    </span>
                </label>
            ))}
        </div>
        {hint && <p class="field-hint">{hint}</p>}
        {error && <span class="form-error">{error}</span>}
    </fieldset>
);
