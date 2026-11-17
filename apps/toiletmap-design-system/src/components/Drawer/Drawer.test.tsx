import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Drawer from "./Drawer";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

const drawer = () => container.querySelector(".drawer") as HTMLElement;

describe("Drawer", () => {
  it("is styled by classes, so CSS (and reduced motion) controls the animation", () => {
    act(() =>
      render(
        <Drawer visible={false} animateFrom="right">
          menu
        </Drawer>,
        container,
      ),
    );
    expect(drawer().className).toBe("drawer drawer--from-right");
    expect(drawer().getAttribute("style")).toBeNull();

    act(() =>
      render(
        <Drawer visible animateFrom="left">
          menu
        </Drawer>,
        container,
      ),
    );
    expect(drawer().className).toBe("drawer drawer--from-left drawer--visible");
  });

  it("sets --drawer-top from offsetTop, never above the viewport", () => {
    act(() =>
      render(
        <Drawer visible animateFrom="right" offsetTop={63.6}>
          menu
        </Drawer>,
        container,
      ),
    );
    expect(drawer().style.getPropertyValue("--drawer-top")).toBe("64px");

    act(() =>
      render(
        <Drawer visible animateFrom="right" offsetTop={-20}>
          menu
        </Drawer>,
        container,
      ),
    );
    expect(drawer().style.getPropertyValue("--drawer-top")).toBe("0px");
  });
});
