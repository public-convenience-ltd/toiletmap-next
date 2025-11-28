export const Button = (props: {
    children: unknown;
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

export const Badge = (props: {
    children: unknown;
    variant?: 'neutral' | 'yes' | 'no' | 'unknown';
    icon?: string;
    title?: string;
}) => {
    const className = `badge badge--${props.variant || 'neutral'}`;
    return (
        <span class={className} title={props.title}>
            {props.icon && <i class={`fa-solid ${props.icon}`} aria-hidden="true"></i>}
            <span>{props.children}</span>
        </span>
    );
};

type CollapsibleCardProps = {
    id: string;
    eyebrow?: string;
    title: string;
    description?: string;
    children: unknown;
    defaultOpen?: boolean;
    showLabel?: string;
    hideLabel?: string;
    className?: string;
};

export const CollapsibleCard = ({
    id,
    eyebrow,
    title,
    description,
    children,
    defaultOpen = true,
    showLabel = 'Show',
    hideLabel = 'Hide',
    className = '',
}: CollapsibleCardProps) => {
    const classes = ['form-card', 'collapsible', className, defaultOpen ? '' : 'collapsible--collapsed']
        .filter(Boolean)
        .join(' ');

    return (
        <section class={classes} data-collapsible={id}>
            <div class="collapsible__header">
                <div>
                    {eyebrow && <p class="section-eyebrow" style="margin-bottom: var(--space-3xs);">{eyebrow}</p>}
                    <h2 class="section-title" style="margin-bottom: var(--space-3xs);">{title}</h2>
                    {description && <p class="section-description">{description}</p>}
                </div>
                <button
                    type="button"
                    class="collapsible__toggle"
                    data-collapsible-toggle
                    data-collapsible-show-label={showLabel}
                    data-collapsible-hide-label={hideLabel}
                >
                    <i class="fa-solid fa-chevron-up collapsible__toggle-icon" aria-hidden="true"></i>
                    <span data-collapsible-label>{defaultOpen ? hideLabel : showLabel}</span>
                </button>
            </div>
            <div class="collapsible__content">{children}</div>
        </section>
    );
};
