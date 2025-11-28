/** @jsxImportSource hono/jsx/dom */

type FormSectionProps = {
    eyebrow: string;
    title: string;
    description?: string;
    children: JSX.Element | JSX.Element[];
    actions?: JSX.Element;
};

export const FormSection = ({ eyebrow, title, description, children, actions }: FormSectionProps) => (
    <section class="form-card">
        <header class="section-header">
            <div>
                <p class="section-eyebrow">{eyebrow}</p>
                <h2 class="section-title">{title}</h2>
                {description && <p class="section-description">{description}</p>}
            </div>
            {actions}
        </header>
        <div class="section-body">{children}</div>
    </section>
);
