import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import IconButton from "../IconButton/IconButton";
import Button from "./Button";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("Button", () => {
  it("carries the .button class that the touch-size rule targets", () => {
    act(() =>
      render(
        <Button htmlElement="button" variant="secondary" type="button">
          Save
        </Button>,
        container,
      ),
    );
    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.classList.contains("button")).toBe(true);
    expect(button.classList.contains("button--secondary")).toBe(true);
  });

  it("marks the destructive variant", () => {
    act(() =>
      render(
        <Button htmlElement="button" variant="destructive" type="button">
          Discard
        </Button>,
        container,
      ),
    );
    expect(container.querySelector("button")?.className).toBe("button button--destructive");
  });

  it("keeps its own classes when given extra ones", () => {
    act(() =>
      render(
        <Button htmlElement="a" variant="primary" href="/x" class="extra">
          Go
        </Button>,
        container,
      ),
    );
    expect(container.querySelector("a")?.className).toBe("button extra");
  });

  it("forwards its ref to the rendered element", () => {
    const buttonRef = createRef<HTMLButtonElement>();
    const anchorRef = createRef<HTMLAnchorElement>();
    act(() =>
      render(
        <>
          <Button htmlElement="button" variant="primary" ref={buttonRef}>
            One
          </Button>
          <Button htmlElement="a" variant="primary" href="/two" ref={anchorRef}>
            Two
          </Button>
        </>,
        container,
      ),
    );
    expect(buttonRef.current).toBe(container.querySelector("button"));
    expect(anchorRef.current).toBe(container.querySelector("a"));
  });
});

describe("IconButton", () => {
  it("carries the .icon-button class that the touch-size rule targets", () => {
    act(() => render(<IconButton icon="xmark" aria-label="Close" class="extra" />, container));
    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.className).toBe("icon-button icon-button--ghost extra");
    expect(button.getAttribute("aria-label")).toBe("Close");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("forwards its ref to the <button>, so focus can be moved to it", () => {
    const ref = createRef<HTMLButtonElement>();
    act(() => render(<IconButton icon="xmark" aria-label="Close" ref={ref} />, container));
    expect(ref.current).toBe(container.querySelector("button"));
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });
});
