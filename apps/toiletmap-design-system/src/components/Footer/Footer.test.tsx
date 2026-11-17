import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Footer, { defaultFooterLinks } from "./Footer";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("Footer", () => {
  it("shows the default links on every screen size by default", () => {
    act(() => render(<Footer />, container));
    const footer = container.querySelector("footer") as HTMLElement;
    expect(footer.classList.contains("footer--hide-on-mobile")).toBe(false);
    expect([...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(
      defaultFooterLinks.map((link) => link.href),
    );
  });

  it("can hide itself on small screens", () => {
    act(() => render(<Footer hideOnMobile />, container));
    expect(container.querySelector("footer")?.classList.contains("footer--hide-on-mobile")).toBe(
      true,
    );
  });

  it("includes Privacy, Dataset, App and Support us in its defaults", () => {
    expect(defaultFooterLinks.map((link) => link.label)).toEqual([
      "Privacy Policy",
      "Dataset",
      "App",
      "Support Us",
    ]);
  });
});
