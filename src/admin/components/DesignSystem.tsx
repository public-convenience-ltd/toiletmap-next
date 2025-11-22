import { JSX } from 'hono/jsx';

export const Button = (props: {
    children: any;
    type?: 'button' | 'submit' | 'reset';
    variant?: 'primary' | 'secondary';
    href?: string;
    onClick?: string;
}) => {
    const className = props.variant === 'secondary' ? 'button button--secondary' : 'button';
    if (props.href) {
        return <a href={props.href} class={className}>{props.children}</a>;
    }
    return <button type={props.type || 'button'} class={className} onclick={props.onClick}>{props.children}</button>;
};

export const Input = (props: {
    label: string;
    type?: string;
    name: string;
    value?: string;
    placeholder?: string;
    error?: string;
}) => {
    return (
        <label style="display: block; margin-bottom: var(--space-m);">
            <span class="form-label" style="display: block; margin-bottom: var(--space-2xs);">{props.label}</span>
            <input
                class="input"
                type={props.type || 'text'}
                name={props.name}
                value={props.value}
                placeholder={props.placeholder}
                style={props.error ? 'border-color: var(--color-accent-pink);' : ''}
            />
            {props.error && <FormError message={props.error} />}
        </label>
    );
};

export const TextArea = (props: {
    label: string;
    name: string;
    value?: string;
    placeholder?: string;
    rows?: number;
    error?: string;
}) => {
    return (
        <label style="display: block; margin-bottom: var(--space-m);">
            <span class="form-label" style="display: block; margin-bottom: var(--space-2xs);">{props.label}</span>
            <textarea
                class="text-area"
                name={props.name}
                rows={props.rows || 4}
                placeholder={props.placeholder}
                style={props.error ? 'border-color: var(--color-accent-pink);' : ''}
            >{props.value}</textarea>
            {props.error && <FormError message={props.error} />}
        </label>
    );
};

export const TriStateToggle = (props: {
    label: string;
    name: string;
    value?: string | null;
    error?: string;
}) => {
    return (
        <div style="margin-bottom: var(--space-m);">
            <span class="form-label" style="display: block; margin-bottom: var(--space-2xs);">{props.label}</span>
            <div class="tri-state-container">
                <label class="tri-state-option">
                    <input type="radio" name={props.name} value="true" checked={props.value === 'true'} />
                    <span class="tri-state-label">Yes</span>
                </label>
                <label class="tri-state-option">
                    <input type="radio" name={props.name} value="false" checked={props.value === 'false'} />
                    <span class="tri-state-label">No</span>
                </label>
                <label class="tri-state-option">
                    <input type="radio" name={props.name} value="" checked={!props.value || props.value === ''} />
                    <span class="tri-state-label">Unknown</span>
                </label>
            </div>
            {props.error && <FormError message={props.error} />}
        </div>
    );
};

export const FormError = (props: { message: string }) => {
    return (
        <span class="form-error">
            {props.message}
        </span>
    );
};
