import type { ComponentChildren } from "preact";
import Button from "../Button/Button";
import type { FooterLink } from "../Footer/Footer";
import { externalLinkProps } from "../Footer/Footer";
import Icon from "../Icon/Icon";

export interface NavLink {
  href: string;
  label: string;
  /** Renders as a primary Button instead of a plain link */
  button?: boolean;
}

interface MainMenuProps {
  links?: NavLink[];
  /**
   * Smaller links listed under the main ones, e.g. the footer's links on
   * pages that hide the footer on small screens.
   */
  secondaryLinks?: FooterLink[];
  onLinkClick?: () => void;
  children?: ComponentChildren;
}

const defaultLinks: NavLink[] = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/posts", label: "Blog" },
  { href: "/loos/add", label: "Add a toilet" },
];

const MainMenu = ({
  links = defaultLinks,
  secondaryLinks,
  onLinkClick,
  children,
}: MainMenuProps) => (
  <div class="header__nav-wrapper">
    <ul class="header__nav">
      {links.map(({ href, label, button }) => (
        <li key={href}>
          {button ? (
            <Button htmlElement="a" variant="primary" href={href} onClick={onLinkClick}>
              {label}
            </Button>
          ) : (
            <a class="header__link" href={href} onClick={onLinkClick}>
              {label}
            </a>
          )}
        </li>
      ))}
    </ul>
    {secondaryLinks && secondaryLinks.length > 0 && (
      <ul class="header__nav header__nav--secondary">
        {secondaryLinks.map(({ href, label, external, icon }) => (
          <li key={href}>
            <a
              class="header__link"
              href={href}
              onClick={onLinkClick}
              {...externalLinkProps(external)}
            >
              <span>{label}</span>
              {icon && <Icon icon={icon} size="medium" />}
            </a>
          </li>
        ))}
      </ul>
    )}
    {children}
  </div>
);

export default MainMenu;
