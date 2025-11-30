/** @jsxImportSource hono/jsx/dom */

type InlineAlertProps = {
  variant?: "success" | "error" | "info";
  title: string;
  message?: string;
  children?: JSX.Element | JSX.Element[];
};

const ICON_MAP = {
  success: "fa-circle-check",
  error: "fa-triangle-exclamation",
  info: "fa-circle-info",
} as const;

export const InlineAlert = ({ variant = "info", title, message, children }: InlineAlertProps) => (
  <div class={`notification notification--${variant}`}>
    <div class="notification__icon">
      <i class={`fa-solid ${ICON_MAP[variant]}`} aria-hidden="true" />
    </div>
    <div class="notification__content">
      <p class="notification__title">{title}</p>
      {message && <p class="notification__message">{message}</p>}
      {children}
    </div>
  </div>
);
