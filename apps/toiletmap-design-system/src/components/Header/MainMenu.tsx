import type { ComponentChildren } from "preact";
import Button from "../Button/Button";

export interface NavLink {
  href: string;
  label: string;
  /** Renders as a primary Button instead of a plain link */
  button?: boolean;
}

interface MainMenuProps {
  links?: NavLink[];
  onLinkClick?: () => void;
  children?: ComponentChildren;
}

const defaultLinks: NavLink[] = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/posts", label: "Blog" },
  { href: "/loos/add", label: "Add a Toilet" },
];

const MainMenu = ({ links = defaultLinks, onLinkClick, children }: MainMenuProps) => (
  <div class="header__nav-wrapper">
    <ul class="header__nav">
      {links.map(({ href, label, button }) => (
        <li key={href}>
          {button ? (
            <Button htmlElement="a" variant="primary" href={href} onClick={onLinkClick}>
              {label}
            </Button>
          ) : (
            <a href={href} onClick={onLinkClick}>
              {label}
            </a>
          )}
        </li>
      ))}
    </ul>
    {children}
  </div>
);

export default MainMenu;
