import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import Center from "../../layout/Center/Center";
import VisuallyHidden from "../../utilities/VisuallyHidden/VisuallyHidden";
import Drawer from "../Drawer/Drawer";
import type { FooterLink } from "../Footer/Footer";
import IconButton from "../IconButton/IconButton";
import Logo from "../Logo/Logo";
import type { NavLink } from "./MainMenu";
import MainMenu from "./MainMenu";

export type { NavLink };

interface HeaderProps {
  logoSrc: string;
  logoHref?: string;
  navLinks?: NavLink[];
  /**
   * Extra links listed under the nav links in the small-screen menu only.
   * Map pages pass the footer's links here, because they hide the footer
   * below 768px (`<Footer hideOnMobile />`).
   */
  drawerLinks?: FooterLink[];
  onLogoClick?: () => void;
}

/** The custom property on :root that holds the header's rendered height. */
export const HEADER_HEIGHT_PROPERTY = "--header-height";

const DRAWER_ID = "header-menu-drawer";

const Header = ({ logoSrc, logoHref = "/", navLinks, drawerLinks, onLogoClick }: HeaderProps) => {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [drawerTop, setDrawerTop] = useState<number | undefined>(undefined);
  const headerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Publish the header's real height (it grows with safe-area padding and
  // text zoom) so the drawer and the map pages can size against it.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(HEADER_HEIGHT_PROPERTY, `${header.offsetHeight}px`);
    };
    publish();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publish);
      return () => {
        window.removeEventListener("resize", publish);
        root.style.removeProperty(HEADER_HEIGHT_PROPERTY);
      };
    }
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEADER_HEIGHT_PROPERTY);
    };
  }, []);

  const toggleMenu = () => {
    if (!isMenuVisible) {
      // On pages that scroll, the header may be partly off-screen: open the
      // drawer from wherever its bottom edge is now.
      const bottom = headerRef.current?.getBoundingClientRect().bottom;
      setDrawerTop(bottom === undefined ? undefined : Math.max(0, bottom));
    }
    setIsMenuVisible(!isMenuVisible);
  };

  // The open menu's keyboard handling lives on the menu's own element as props, not in an
  // effect per open menu: effects only run after the next paint, so a Tab or Escape pressed
  // straight after opening would arrive before the listeners did, and the menu would stay
  // open. Props are in place as soon as the open menu has rendered.
  const trapFocus = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!isMenuVisible || e.key !== "Tab") return;
    const focusableElements = e.currentTarget.querySelectorAll<HTMLElement>(
      "a[href]:not([disabled]), button:not([disabled])",
    );
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const closeOnEscape = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!isMenuVisible || e.key !== "Escape") return;
    setIsMenuVisible(false);
    buttonRef.current?.focus();
  };

  return (
    <header class="header" ref={headerRef}>
      <Center gutter>
        <div class="header__stack">
          <a href={logoHref} aria-label="Navigate to the home page" onClick={onLogoClick}>
            <Logo src={logoSrc} />
          </a>

          <nav aria-labelledby="menu-main">
            <VisuallyHidden as="div">
              <h2 id="menu-main">Main menu</h2>
            </VisuallyHidden>

            {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated keyboard handling for the toggle and the menu's links inside it, which are the interactive elements */}
            <div class="header__smaller-devices" onKeyDown={trapFocus} onKeyUp={closeOnEscape}>
              <IconButton
                icon={isMenuVisible ? "xmark" : "bars"}
                aria-label="Toggle main menu"
                aria-expanded={isMenuVisible}
                aria-controls={DRAWER_ID}
                variant="filled"
                size="large"
                onClick={toggleMenu}
                ref={buttonRef}
              />

              <Drawer
                id={DRAWER_ID}
                visible={isMenuVisible}
                animateFrom="right"
                offsetTop={drawerTop}
              >
                <MainMenu
                  links={navLinks}
                  secondaryLinks={drawerLinks}
                  onLinkClick={() => setIsMenuVisible(false)}
                />
              </Drawer>
            </div>

            <div class="header__larger-devices">
              <MainMenu links={navLinks} />
            </div>
          </nav>
        </div>
      </Center>
    </header>
  );
};

export default Header;
