import type { JSX } from "preact";
import { forwardRef } from "preact/compat";

interface LogoProps extends JSX.HTMLAttributes<HTMLDivElement> {
  src: string;
  alt?: string;
}

const Logo = forwardRef<HTMLDivElement, LogoProps>(({ src, alt = "Toilet Map", ...props }, ref) => (
  <div class="logo" ref={ref} {...props}>
    <img src={src} alt={alt} />
  </div>
));

Logo.displayName = "Logo";
export default Logo;
