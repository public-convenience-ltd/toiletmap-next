import type { ComponentChildren } from "preact";
import Icon from "../Icon/Icon";

export type BannerVariant = "success" | "error" | "warning" | "info";

interface BannerProps {
  variant?: BannerVariant;
  title?: string;
  children: ComponentChildren;
}

const Banner = ({ variant = "info", title, children }: BannerProps) => {
  const role = variant === "error" || variant === "warning" ? "alert" : "status";
  const icon = variant === "error" || variant === "warning" ? "warning" : variant;

  return (
    <div class={`banner banner--${variant}`} {...(role === "alert" ? { role: "alert" } : {})}>
      <div class="banner__content">
        {title && (
          <h2 class="banner__title">
            <Icon icon={icon as "warning" | "info" | "success"} size="large" />
            {title}
          </h2>
        )}
        <div>{children}</div>
      </div>
    </div>
  );
};

export default Banner;
