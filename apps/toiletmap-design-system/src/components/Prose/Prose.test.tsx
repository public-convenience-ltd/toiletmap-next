import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Prose from "./Prose";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("Prose", () => {
  it("wraps its children in a .prose div by default", () => {
    act(() =>
      render(
        <Prose>
          <h2>Heading</h2>
          <p>Text</p>
        </Prose>,
        container,
      ),
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root.className).toBe("prose");
    expect(root.querySelector("h2")?.textContent).toBe("Heading");
  });

  it("can be an article with extra classes and an id", () => {
    act(() =>
      render(
        <Prose as="article" class="post" id="body">
          <p>Text</p>
        </Prose>,
        container,
      ),
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("ARTICLE");
    expect(root.className).toBe("prose post");
    expect(root.id).toBe("body");
  });

  it("renders trusted HTML (e.g. from Markdown)", () => {
    act(() =>
      render(<Prose dangerouslySetInnerHTML={{ __html: "<ul><li>One</li></ul>" }} />, container),
    );
    expect(container.querySelector(".prose li")?.textContent).toBe("One");
  });
});
