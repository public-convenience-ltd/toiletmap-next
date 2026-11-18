import Center from "../../layout/Center/Center";
import Icon from "../Icon/Icon";

export interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
  icon?: "patreon";
}

interface FooterProps {
  links?: FooterLink[];
  /**
   * Hide the footer below 768px. Map pages use this to give the map the
   * whole screen; pass the same links to `Header`'s `drawerLinks` so they
   * are still reachable from the menu.
   */
  hideOnMobile?: boolean;
}

export const defaultFooterLinks: FooterLink[] = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/dataset", label: "Dataset" },
  { href: "/app", label: "App" },
  {
    href: "https://www.patreon.com/toiletmap",
    label: "Support Us",
    external: true,
    icon: "patreon",
  },
];

/** `target`/`rel` for a link that leaves the site. */
export const externalLinkProps = (external?: boolean) =>
  external ? { target: "_blank", rel: "noopener noreferrer" } : {};

const Footer = ({ links = defaultFooterLinks, hideOnMobile = false }: FooterProps) => (
  <footer class={`footer${hideOnMobile ? " footer--hide-on-mobile" : ""}`}>
    <Center gutter>
      <div class="footer__container">
        <ul class="footer__list">
          {links.map(({ href, label, external, icon }) => (
            <li key={href} class="footer__list-item">
              <a class="footer__link" href={href} {...externalLinkProps(external)}>
                <span>{label}</span>
                {icon && <Icon icon={icon} size="medium" />}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Center>
  </footer>
);

export default Footer;
