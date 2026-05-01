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
}

const defaultLinks: FooterLink[] = [
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

const Footer = ({ links = defaultLinks }: FooterProps) => (
  <footer class="footer">
    <Center gutter>
      <div class="footer__container">
        <ul class="footer__list">
          {links.map(({ href, label, external, icon }) => (
            <li key={href} class="footer__list-item">
              <a
                class="footer__link"
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
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
