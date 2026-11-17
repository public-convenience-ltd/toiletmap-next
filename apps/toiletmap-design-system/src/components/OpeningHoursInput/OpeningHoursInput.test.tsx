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

  const buttonByText = (text: string): HTMLButtonElement => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`No button "${text}"`);
    return button as HTMLButtonElement;
  };

  const checkbox24h = (day: string) =>
    container.querySelector(`input[aria-label="${day}: open 24 hours"]`) as HTMLInputElement | null;

  const DAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ] as const;

  it("copies Monday's hours to all days", () => {
    const value: OpeningTimes = [["06:30", "22:00"], [], ["10:00", "12:00"], [], [], [], []];
    const onChange = renderInput(value);
    act(() => {
      buttonByText("Copy Monday's hours to all days").click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted).toEqual(Array.from({ length: 7 }, () => ["06:30", "22:00"]));
    // The emitted days are copies, not the same array as Monday.
    expect(emitted[1]).not.toBe(emitted[0]);
    // The value passed in is not mutated.
    expect(value[1]).toEqual([]);
  });

  it("copies a closed Monday to Monday–Friday and leaves the weekend alone", () => {
    const value: OpeningTimes = [
      [],
      ...Array.from({ length: 6 }, () => ["09:00", "17:00"]),
    ] as OpeningTimes;
    const onChange = renderInput(value);
    act(() => {
      buttonByText("Copy Monday to weekdays (Mon–Fri)").click();
    });
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted.slice(0, 5)).toEqual([[], [], [], [], []]);
    expect(emitted.slice(5)).toEqual([
      ["09:00", "17:00"],
      ["09:00", "17:00"],
    ]);
  });

  it("copies Monday's 24-hour opening to every day", () => {
    const value: OpeningTimes = [["00:00", "00:00"], [], [], [], [], [], []];
    const onChange = renderInput(value);
    act(() => {
      buttonByText("Copy Monday's hours to all days").click();
    });
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted.every((day) => day[0] === "00:00" && day[1] === "00:00")).toBe(true);
  });

  it("turning on 24 hours emits 00:00–00:00 for that day only", () => {
    const value: OpeningTimes = Array.from({ length: 7 }, () => ["09:00", "17:00"]);
    const onChange = renderInput(value);
    const wednesday = checkbox24h("Wednesday");
    expect(wednesday?.checked).toBe(false);
    act(() => {
      wednesday?.click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted[2]).toEqual(["00:00", "00:00"]);
    emitted.forEach((day, index) => {
      if (index !== 2) expect(day).toEqual(["09:00", "17:00"]);
    });
  });

  it("turning off 24 hours restores the default 09:00–17:00 and shows the time inputs again", () => {
    const value: OpeningTimes = Array.from({ length: 7 }, () => ["09:00", "17:00"]);
    value[4] = ["00:00", "00:00"];
    const onChange = vi.fn();
    renderInput(value, onChange);
    expect(container.textContent).toContain("Open 24 hours");
    expect(container.querySelector('input[aria-label="Friday opening time"]')).toBeNull();

    act(() => {
      checkbox24h("Friday")?.click();
    });
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted[4]).toEqual(["09:00", "17:00"]);

    // Parent feeds the new value back in (controlled round trip).
    renderInput(emitted, onChange);
    expect(checkbox24h("Friday")?.checked).toBe(false);
    const fridayOpen = container.querySelector(
      'input[aria-label="Friday opening time"]',
    ) as HTMLInputElement;
    expect(fridayOpen.value).toBe("09:00");
  });

  it("marks a day closed or open via its status radios", () => {
    const value: OpeningTimes = Array.from({ length: 7 }, () => ["08:00", "18:00"]);
    const onChange = renderInput(value);
    const sunday = container.querySelector('fieldset[data-day="Sunday"]') as HTMLElement;
    const closed = sunday.querySelector('input[value="closed"]') as HTMLInputElement;
    act(() => {
      closed.click();
    });
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted[6]).toEqual([]);

    renderInput(emitted, onChange);
    const sundayAfter = container.querySelector('fieldset[data-day="Sunday"]') as HTMLElement;
    expect(sundayAfter.querySelector('input[type="time"]')).toBeNull();
    expect(checkbox24h("Sunday")).toBeNull();
    act(() => {
      (sundayAfter.querySelector('input[value="open"]') as HTMLInputElement).click();
    });
    expect((onChange.mock.calls[1][0] as OpeningTimes)[6]).toEqual(["09:00", "17:00"]);
  });

  it("emits the edited time for the right day and position", () => {
    const value: OpeningTimes = Array.from({ length: 7 }, () => ["09:00", "17:00"]);
    const onChange = renderInput(value);
    const tuesdayClose = container.querySelector(
      'input[aria-label="Tuesday closing time"]',
    ) as HTMLInputElement;
    act(() => {
      tuesdayClose.value = "19:45";
      tuesdayClose.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted[1]).toEqual(["09:00", "19:45"]);
    expect(emitted[0]).toEqual(["09:00", "17:00"]);
  });

  it("controlled rerender: reflects every day's value and 24h state from props", () => {
    const onChange = vi.fn();
    const first: OpeningTimes = Array.from({ length: 7 }, () => ["09:00", "17:00"]);
    renderInput(first, onChange);
    for (const day of DAY_NAMES) expect(checkbox24h(day)?.checked).toBe(false);

    const second: OpeningTimes = [
      ["00:00", "00:00"],
      ["07:00", "19:00"],
      [],
      ["10:00", "16:00"],
      ["00:00", "00:00"],
      [],
      ["11:00", "15:00"],
    ];
    renderInput(second, onChange);
    expect(checkbox24h("Monday")?.checked).toBe(true);
    expect(checkbox24h("Friday")?.checked).toBe(true);
    expect(checkbox24h("Wednesday")).toBeNull();
    expect(checkbox24h("Saturday")).toBeNull();
    const time = (label: string) =>
      (container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null)?.value;
    expect(time("Tuesday opening time")).toBe("07:00");
    expect(time("Thursday closing time")).toBe("16:00");
    expect(time("Sunday opening time")).toBe("11:00");
    expect(time("Monday opening time")).toBeUndefined();
    // Rendering alone never emits.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an error message linked to the mode radiogroup", () => {
    act(() => {
      render(
        <OpeningHoursInput value={null} onChange={vi.fn()} error="Enter valid hours" />,
        container,
      );
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Enter valid hours");
    const group = container.querySelector(".oh-mode");
    expect(group?.getAttribute("aria-describedby")).toBe(alert?.id);
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
