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
}) => {
    return (
        <label style="display: block; margin-bottom: var(--space-m);">
            <span style="font-weight: bold;">{props.label}</span>
            <input
                class="input"
                type={props.type || 'text'}
                name={props.name}
                value={props.value}
                placeholder={props.placeholder}
            />
        </label>
    );
};

export const TriStateToggle = (props: {
    label: string;
    name: string;
    value?: string | null; // 'true', 'false', or null/undefined
}) => {
    // Simple implementation using radio buttons for now
    return (
        <div style="margin-bottom: var(--space-m);">
            <span style="font-weight: bold; display: block; margin-bottom: var(--space-3xs);">{props.label}</span>
            <div style="display: flex; gap: var(--space-s);">
                <label style="display: flex; align-items: center; gap: var(--space-3xs);">
                    <input type="radio" name={props.name} value="true" checked={props.value === 'true'} />
                    Yes
                </label>
                <label style="display: flex; align-items: center; gap: var(--space-3xs);">
                    <input type="radio" name={props.name} value="false" checked={props.value === 'false'} />
                    No
                </label>
                <label style="display: flex; align-items: center; gap: var(--space-3xs);">
                    <input type="radio" name={props.name} value="" checked={!props.value} />
                    Unknown
                </label>
            </div>
        </div>
    );
};
