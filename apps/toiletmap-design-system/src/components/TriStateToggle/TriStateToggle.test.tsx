import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TriStateToggle, { type TriStateValue } from "./TriStateToggle";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const renderToggle = (
  value: TriStateValue,
  onChange = vi.fn(),
  extra: { hint?: string; error?: string; unknownLabel?: string } = {},
) => {
  act(() => {
    render(
      <TriStateToggle
        name="accessible"
        label="Accessible"
        value={value}
        onChange={onChange}
        {...extra}
      />,
      container,
    );
  });
  return onChange;
};

const radio = (text: string): HTMLInputElement => {
  const label = Array.from(container.querySelectorAll("label")).find(
    (el) => el.textContent?.trim() === text,
  );
  const input = label?.querySelector('input[type="radio"]');
  if (!input) throw new Error(`No radio labelled "${text}"`);
  return input as HTMLInputElement;
};

const activeLabels = () =>
  Array.from(container.querySelectorAll(".tri-state-label--active")).map((el) => el.textContent);

describe("TriStateToggle", () => {
  it("renders a labelled group of Yes / No / Don't know radios sharing one name", () => {
    renderToggle("");
    const fieldset = container.querySelector("fieldset");
    expect(fieldset?.querySelector("legend")?.textContent).toBe("Accessible");
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((r) => r.value)).toEqual(["true", "false", ""]);
    expect(radios.every((r) => r.name === "accessible")).toBe(true);
    expect(fieldset?.getAttribute("aria-invalid")).toBe("false");
  });

  it.each([
    ["true", "Yes"],
    ["false", "No"],
    ["", "Don't know"],
  ] as const)("checks only the matching option for value %j", (value, label) => {
    renderToggle(value);
    expect(radio(label).checked).toBe(true);
    const others = ["Yes", "No", "Don't know"].filter((l) => l !== label);
    for (const other of others) expect(radio(other).checked).toBe(false);
    expect(activeLabels()).toEqual([label]);
  });

  it("emits the clicked option's value", () => {
    const onChange = renderToggle("");
    act(() => radio("Yes").click());
    expect(onChange).toHaveBeenLastCalledWith("true");
    act(() => radio("No").click());
    expect(onChange).toHaveBeenLastCalledWith("false");
  });

  it("emits an empty string for Don't know", () => {
    const onChange = renderToggle("true");
    act(() => radio("Don't know").click());
    expect(onChange).toHaveBeenCalledWith("");
  });

  it('labels the no-answer option "Don\'t know" by default, and accepts another label', () => {
    renderToggle("");
    expect(Array.from(container.querySelectorAll("label")).map((l) => l.textContent)).toEqual([
      "Yes",
      "No",
      "Don't know",
    ]);
    const onChange = renderToggle("true", vi.fn(), { unknownLabel: "Not sure" });
    expect(radio("Not sure").value).toBe("");
    expect(container.textContent).not.toContain("Don't know");
    act(() => radio("Not sure").click());
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("is controlled: the checked option follows the value prop", () => {
    const onChange = vi.fn();
    renderToggle("true", onChange);
    expect(radio("Yes").checked).toBe(true);
    renderToggle("false", onChange);
    expect(radio("No").checked).toBe(true);
    expect(radio("Yes").checked).toBe(false);
    expect(activeLabels()).toEqual(["No"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a hint and an error, and marks the group invalid", () => {
    renderToggle("", vi.fn(), { hint: "Step-free access", error: "Choose an option" });
    expect(container.querySelector(".tri-state-hint")?.textContent).toBe("Step-free access");
    expect(container.querySelector(".tri-state-error")?.textContent).toBe("Choose an option");
    expect(container.querySelector("fieldset")?.getAttribute("aria-invalid")).toBe("true");
  });
});
