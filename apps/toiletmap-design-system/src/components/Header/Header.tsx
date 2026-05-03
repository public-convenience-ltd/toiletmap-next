import { useEffect, useRef, useState } from "preact/hooks";
import Center from "../../layout/Center/Center";
import VisuallyHidden from "../../utilities/VisuallyHidden/VisuallyHidden";
import Drawer from "../Drawer/Drawer";
import IconButton from "../IconButton/IconButton";
import Logo from "../Logo/Logo";
import type { NavLink } from "./MainMenu";
import MainMenu from "./MainMenu";

export type { NavLink };

interface HeaderProps {
  logoSrc: string;
  logoHref?: string;
  navLinks?: NavLink[];
  onLogoClick?: () => void;
}

const Header = ({ logoSrc, logoHref = "/", navLinks, onLogoClick }: HeaderProps) => {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuVisible) return;

    const navElement = navRef.current;
    if (!navElement) return;

    const focusableElements = navElement.querySelectorAll<HTMLElement>(
      "a[href]:not([disabled]), button:not([disabled])",
    );
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    const focusTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
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

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuVisible(false);
        buttonRef.current?.focus();
      }
    };

    navElement.addEventListener("keydown", focusTrap);
    navElement.addEventListener("keyup", handleEscape);
    return () => {
      navElement.removeEventListener("keydown", focusTrap);
      navElement.removeEventListener("keyup", handleEscape);
    };
  }, [isMenuVisible]);

  return (
    <header class="header">
      <Center gutter>
        <div class="header__stack">
          <a href={logoHref} aria-label="Navigate to the home page" onClick={onLogoClick}>
            <Logo src={logoSrc} />
          </a>

          <nav aria-labelledby="menu-main">
            <VisuallyHidden as="div">
              <h2 id="menu-main">Main menu</h2>
            </VisuallyHidden>

            <div class="header__smaller-devices" ref={navRef}>
              <IconButton
                icon={isMenuVisible ? "xmark" : "bars"}
                aria-label="Toggle main menu"
                aria-expanded={isMenuVisible}
                aria-haspopup="true"
                variant="filled"
                size="large"
                onClick={() => setIsMenuVisible(!isMenuVisible)}
                ref={buttonRef}
              />

              <Drawer visible={isMenuVisible} animateFrom="right">
                <MainMenu links={navLinks} onLinkClick={() => setIsMenuVisible(false)} />
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
