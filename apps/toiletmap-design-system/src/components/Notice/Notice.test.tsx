import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Banner from "../Banner/Banner";
import Notice, { type NoticeTone } from "./Notice";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

const notice = () => container.querySelector<HTMLElement>(".notice") as HTMLElement;
const iconHref = () => notice().querySelector(".notice__icon use")?.getAttribute("href");

describe("Notice", () => {
  it.each([
    ["info", "status", "info"],
    ["success", "status", "success"],
    ["warning", "status", "warning"],
    ["error", "alert", "circle-xmark"],
  ] as const)("a %s notice is role=%s with its own icon", (tone, role, icon) => {
    act(() => render(<Notice tone={tone as NoticeTone}>Body</Notice>, container));
    expect(notice().getAttribute("role")).toBe(role);
    expect(notice().classList.contains(`notice--${tone}`)).toBe(true);
    expect(iconHref()).toBe(`/sprites/solid.svg#${icon}`);
  });

  it("defaults to info", () => {
    act(() => render(<Notice>Body</Notice>, container));
    expect(notice().classList.contains("notice--info")).toBe(true);
  });

  it("can be announced assertively or not at all", () => {
    act(() => render(<Notice announce="assertive">Body</Notice>, container));
    expect(notice().getAttribute("role")).toBe("alert");
    act(() =>
      render(
        <Notice tone="error" announce="off">
          Body
        </Notice>,
        container,
      ),
    );
    expect(notice().hasAttribute("role")).toBe(false);
  });

  it("shows the title as a bold paragraph, or a heading of the given level", () => {
    act(() => render(<Notice title="Saved">Body</Notice>, container));
    expect(notice().querySelector("p.notice__title")?.textContent).toBe("Saved");
    act(() =>
      render(
        <Notice title="Saved" headingLevel={3}>
          Body
        </Notice>,
        container,
      ),
    );
    expect(notice().querySelector("h3.notice__title")?.textContent).toBe("Saved");
    expect(notice().querySelector("p.notice__title")).toBeNull();
  });

  it("shows an icon without a title too, and can hide it or swap it", () => {
    act(() => render(<Notice tone="success">Body</Notice>, container));
    expect(iconHref()).toBe("/sprites/solid.svg#success");
    act(() =>
      render(
        <Notice tone="success" icon={false}>
          Body
        </Notice>,
        container,
      ),
    );
    expect(notice().querySelector(".notice__icon")).toBeNull();
    act(() =>
      render(
        <Notice tone="success" icon="clock">
          Body
        </Notice>,
        container,
      ),
    );
    expect(iconHref()).toBe("/sprites/solid.svg#clock");
  });

  it("has a dismiss button with an accessible name only when it can be dismissed", () => {
    act(() => render(<Notice>Body</Notice>, container));
    expect(notice().querySelector("button")).toBeNull();

    const onDismiss = vi.fn();
    act(() =>
      render(
        <Notice onDismiss={onDismiss} dismissLabel="Dismiss saved message">
          Body
        </Notice>,
        container,
      ),
    );
    const button = notice().querySelector<HTMLButtonElement>(".notice__dismiss");
    expect(button?.getAttribute("aria-label")).toBe("Dismiss saved message");
    expect(button?.type).toBe("button");
    act(() => button?.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("names the dismiss button 'Dismiss' by default", () => {
    act(() => render(<Notice onDismiss={vi.fn()}>Body</Notice>, container));
    expect(notice().querySelector(".notice__dismiss")?.getAttribute("aria-label")).toBe("Dismiss");
  });

  it("renders a button action or a link action", () => {
    const onClick = vi.fn();
    act(() => render(<Notice action={{ label: "Undo", onClick }}>Body</Notice>, container));
    const button = notice().querySelector<HTMLButtonElement>(".notice__actions button");
    expect(button?.textContent).toBe("Undo");
    expect(button?.classList.contains("button--secondary")).toBe(true);
    act(() => button?.click());
    expect(onClick).toHaveBeenCalledTimes(1);

    act(() =>
      render(
        <Notice action={{ label: "View the toilet", href: "/loos/abc" }}>Body</Notice>,
        container,
      ),
    );
    const link = notice().querySelector<HTMLAnchorElement>(".notice__actions a");
    expect(link?.getAttribute("href")).toBe("/loos/abc");
    expect(link?.textContent).toBe("View the toilet");
  });

  it("renders custom actions after the action", () => {
    act(() =>
      render(
        <Notice
          action={{ label: "First", onClick: vi.fn() }}
          actions={<button type="button">Second</button>}
        >
          Body
        </Notice>,
        container,
      ),
    );
    const labels = Array.from(notice().querySelectorAll(".notice__actions button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["First", "Second"]);
  });

  it("has no action row without actions", () => {
    act(() => render(<Notice>Body</Notice>, container));
    expect(notice().querySelector(".notice__actions")).toBeNull();
  });

  it("when focused on mount it is a labelled group, not a live region", () => {
    act(() =>
      render(
        <Notice tone="error" title="There's a problem" autoFocus>
          Body
        </Notice>,
        container,
      ),
    );
    const el = notice();
    expect(document.activeElement).toBe(el);
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("tabindex")).toBe("-1");
    const title = el.querySelector(".notice__title") as HTMLElement;
    expect(el.getAttribute("aria-labelledby")).toBe(title.id);
  });

  it("adds the compact size and any extra class", () => {
    act(() =>
      render(
        <Notice size="compact" class="extra">
          Body
        </Notice>,
        container,
      ),
    );
    expect(notice().className).toBe("notice notice--info notice--compact extra");
  });
});

describe("Banner (deprecated wrapper)", () => {
  it("keeps its classes, its h2 title and its roles", () => {
    act(() =>
      render(
        <Banner variant="warning" title="Changed by someone else">
          Body
        </Banner>,
        container,
      ),
    );
    const el = notice();
    expect(el.classList.contains("banner")).toBe(true);
    expect(el.classList.contains("banner--warning")).toBe(true);
    expect(el.classList.contains("notice--warning")).toBe(true);
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.querySelector("h2")?.textContent).toBe("Changed by someone else");
  });

  it("gives info and success no live role, as before", () => {
    act(() => render(<Banner variant="success">Saved</Banner>, container));
    expect(notice().hasAttribute("role")).toBe(false);
    act(() => render(<Banner>Note</Banner>, container));
    expect(notice().hasAttribute("role")).toBe(false);
    act(() => render(<Banner variant="error">Failed</Banner>, container));
    expect(notice().getAttribute("role")).toBe("alert");
  });
});
