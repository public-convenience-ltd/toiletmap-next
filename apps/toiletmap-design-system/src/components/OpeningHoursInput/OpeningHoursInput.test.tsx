import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpeningHoursInput from "./OpeningHoursInput";
import type { OpeningTimes } from "./openingTimes";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const renderInput = (value: OpeningTimes | null, onChange = vi.fn()) => {
  act(() => {
    render(<OpeningHoursInput value={value} onChange={onChange} />, container);
  });
  return onChange;
};

const radioByLabel = (text: string): HTMLInputElement => {
  const label = Array.from(container.querySelectorAll("label")).find(
    (el) => el.textContent?.trim() === text,
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`No radio labelled "${text}"`);
  return input as HTMLInputElement;
};

const dayRows = () => container.querySelectorAll(".oh-row");

describe("OpeningHoursInput", () => {
  it("shows 'Don't know' selected and no day rows when value is null", () => {
    renderInput(null);
    expect(radioByLabel("Don't know").checked).toBe(true);
    expect(radioByLabel("Set opening hours").checked).toBe(false);
    expect(dayRows()).toHaveLength(0);
    expect(container.textContent).not.toContain("Monday");
  });

  it("emits a 7-day 09:00–17:00 week when choosing 'Set opening hours'", () => {
    const onChange = renderInput(null);
    act(() => {
      radioByLabel("Set opening hours").click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted).toHaveLength(7);
    expect(emitted.every((day) => day[0] === "09:00" && day[1] === "17:00")).toBe(true);
  });

  it("emits null when choosing 'Don't know'", () => {
    const onChange = renderInput(Array.from({ length: 7 }, () => ["09:00", "17:00"]));
    act(() => {
      radioByLabel("Don't know").click();
    });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("is controlled: re-rendering with a new value updates the displayed times", () => {
    const onChange = vi.fn();
    const first: OpeningTimes = Array.from({ length: 7 }, () => ["09:00", "17:00"]);
    renderInput(first, onChange);
    const mondayOpen = () =>
      container.querySelector('input[aria-label="Monday opening time"]') as HTMLInputElement;
    expect(mondayOpen().value).toBe("09:00");
    expect(dayRows()).toHaveLength(7);

    const second: OpeningTimes = [...first];
    second[0] = ["07:30", "18:00"];
    renderInput(second, onChange);
    expect(mondayOpen().value).toBe("07:30");

    // Back to unknown hides the rows again
    renderInput(null, onChange);
    expect(dayRows()).toHaveLength(0);
  });

  it("treats any equal pair as open 24 hours", () => {
    const value: OpeningTimes = [["12:00", "12:00"], [], [], [], [], [], []];
    renderInput(value);
    const checkbox = container.querySelector(
      'input[aria-label="Monday: open 24 hours"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(container.querySelector('input[aria-label="Monday opening time"]')).toBeNull();
    // Closed days show no time inputs or 24 hours option
    expect(container.querySelector('input[aria-label="Tuesday: open 24 hours"]')).toBeNull();
  });

  it("copies Monday's hours to weekdays only", () => {
    const value: OpeningTimes = [["08:00", "20:00"], [], [], [], [], [], []];
    const onChange = renderInput(value);
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("weekdays"),
    ) as HTMLButtonElement;
    act(() => {
      button.click();
    });
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => ["08:00", "20:00"]));
    expect(emitted[5]).toEqual([]);
    expect(emitted[6]).toEqual([]);
  });

  it("labels each day's controls with the day name", () => {
    renderInput(Array.from({ length: 7 }, () => ["09:00", "17:00"]));
    const groups = container.querySelectorAll("fieldset.oh-day-group");
    expect(groups).toHaveLength(7);
    const legend = groups[0].querySelector("legend");
    expect(legend?.textContent).toBe("Monday");
    const status = groups[0].querySelector('[role="radiogroup"]');
    expect(status?.getAttribute("aria-labelledby")).toBe(legend?.id);
  });
});
