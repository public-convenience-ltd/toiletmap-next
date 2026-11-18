import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFooterLinks } from "../Footer/Footer";
import Header, { HEADER_HEIGHT_PROPERTY } from "./Header";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

const navLinks = [
  { href: "/about", label: "About" },
  { href: "/loos/add", label: "Add a Toilet", button: true },
];

const renderHeader = (props: Partial<Parameters<typeof Header>[0]> = {}) => {
  act(() => {
    render(<Header logoSrc="/logo.svg" navLinks={navLinks} {...props} />, container);
  });
};

const toggle = () =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Toggle main menu"]',
  ) as HTMLButtonElement;
const drawer = () => container.querySelector<HTMLElement>(".drawer") as HTMLElement;
const desktopMenu = () =>
  container.querySelector<HTMLElement>(".header__larger-devices") as HTMLElement;
/** Link names as a screen reader announces them (icons are aria-hidden). */
const linkTexts = (root: Element) =>
  [...root.querySelectorAll("a")].map((a) => {
    const clone = a.cloneNode(true) as HTMLElement;
    for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return clone.textContent?.trim();
  });

describe("Header", () => {
  it("lists drawerLinks in the small-screen drawer only", () => {
    renderHeader({ drawerLinks: defaultFooterLinks });

    expect(linkTexts(drawer())).toEqual([
      "About",
      "Add a Toilet",
      "Privacy Policy",
      "Dataset",
      "App",
      "Support Us",
    ]);
    expect(linkTexts(desktopMenu())).toEqual(["About", "Add a Toilet"]);
  });

  it("opens drawer links that leave the site in a new tab", () => {
    renderHeader({ drawerLinks: defaultFooterLinks });
    const support = [...drawer().querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Support Us"),
    );
    expect(support?.getAttribute("href")).toBe("https://www.patreon.com/toiletmap");
    expect(support?.getAttribute("target")).toBe("_blank");
    expect(support?.getAttribute("rel")).toBe("noopener noreferrer");

    const privacy = [...drawer().querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Privacy"),
    );
    expect(privacy?.hasAttribute("target")).toBe(false);
  });

  it("renders no secondary list without drawerLinks", () => {
    renderHeader();
    expect(container.querySelector(".header__nav--secondary")).toBeNull();
  });

  it("toggles the drawer and reports it with aria-expanded and aria-controls", () => {
    renderHeader();
    const button = toggle();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(drawer().id);
    expect(drawer().classList.contains("drawer--visible")).toBe(false);

    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(drawer().classList.contains("drawer--visible")).toBe(true);

    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(drawer().classList.contains("drawer--visible")).toBe(false);
  });

  it("closes on Escape and returns focus to the menu button", () => {
    renderHeader({ drawerLinks: defaultFooterLinks });
    act(() => toggle().click());
    const link = drawer().querySelector("a") as HTMLAnchorElement;
    link.focus();

    act(() => {
      link.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    });

    expect(drawer().classList.contains("drawer--visible")).toBe(false);
    expect(document.activeElement).toBe(toggle());
  });

  // Outside act(), as in a browser: the click's render runs as a microtask but effects wait
  // for the next paint, so a key pressed in between must not depend on an effect.
  const openWithoutFlushingEffects = async () => {
    toggle().click();
    await Promise.resolve();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  };

  it("closes on an Escape pressed straight after opening, before the next paint", async () => {
    renderHeader({ drawerLinks: defaultFooterLinks });
    toggle().focus();
    await openWithoutFlushingEffects();

    toggle().dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    await Promise.resolve();

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(drawer().classList.contains("drawer--visible")).toBe(false);
    expect(document.activeElement).toBe(toggle());
  });

  it("keeps Tab inside the menu straight after opening, before the next paint", async () => {
    renderHeader({ drawerLinks: defaultFooterLinks });
    await openWithoutFlushingEffects();
    const links = drawer().querySelectorAll("a");
    const last = links[links.length - 1] as HTMLAnchorElement;
    last.focus();

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    last.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toggle());
  });

  it("ignores Escape while the menu is closed", () => {
    renderHeader();
    const button = toggle();
    act(() => {
      button.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(button);
  });

  it("closes when a drawer link is followed", () => {
    renderHeader({ drawerLinks: defaultFooterLinks });
    act(() => toggle().click());
    const dataset = [...drawer().querySelectorAll("a")].find(
      (a) => a.textContent === "Dataset",
    ) as HTMLAnchorElement;
    dataset.addEventListener("click", (e) => e.preventDefault());

    act(() => dataset.click());

    expect(drawer().classList.contains("drawer--visible")).toBe(false);
  });

  it("opens the drawer from the header's bottom edge", () => {
    renderHeader();
    const header = container.querySelector("header") as HTMLElement;
    header.getBoundingClientRect = () => ({ bottom: 72 }) as DOMRect;

    act(() => toggle().click());

    expect(drawer().style.getPropertyValue("--drawer-top")).toBe("72px");
  });

  it("publishes its height as --header-height and clears it when unmounted", () => {
    renderHeader();
    expect(document.documentElement.style.getPropertyValue(HEADER_HEIGHT_PROPERTY)).toMatch(
      /^\d+px$/,
    );

    act(() => render(null, container));
    expect(document.documentElement.style.getPropertyValue(HEADER_HEIGHT_PROPERTY)).toBe("");
  });
});
