import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpeningHoursInput from "./OpeningHoursInput";
import type { DayHours, OpeningTimes } from "./openingTimes";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const week = (day: DayHours): OpeningTimes => Array.from({ length: 7 }, () => [...day] as DayHours);

/** Mon–Fri 08:00–18:00, Sat–Sun 10:00–16:00: fits "Weekdays + weekends". */
const weekdaysWeekend: OpeningTimes = [
  ...week(["08:00", "18:00"]).slice(0, 5),
  ["10:00", "16:00"],
  ["10:00", "16:00"],
];

/** Different hours on most days: fits only "Different each day". */
const variedWeek = (): OpeningTimes => [
  ["09:00", "17:00"],
  ["08:00", "18:00"],
  [],
  ["10:00", "16:00"],
  ["22:00", "02:00"],
  ["00:00", "00:00"],
  ["11:00", "15:00"],
];

const renderInput = (
  value: OpeningTimes | null,
  onChange: (v: OpeningTimes | null) => void = vi.fn(),
  extra: { error?: string; id?: string } = {},
) => {
  act(() => {
    render(<OpeningHoursInput value={value} onChange={onChange} {...extra} />, container);
  });
  return onChange as ReturnType<typeof vi.fn>;
};

/** A stateful parent, so interactions round-trip through `value` like a real form. */
const renderControlled = (initial: OpeningTimes | null) => {
  const changes: (OpeningTimes | null)[] = [];
  const Harness = () => {
    const [value, setValue] = useState<OpeningTimes | null>(initial);
    return (
      <OpeningHoursInput
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  };
  act(() => {
    render(<Harness />, container);
  });
  return changes;
};

const radio = (text: string, scope: ParentNode = container): HTMLInputElement => {
  const label = Array.from(scope.querySelectorAll("label")).find(
    (el) => el.textContent?.trim() === text,
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`No radio labelled "${text}"`);
  return input as HTMLInputElement;
};

const click = (el: HTMLElement) => {
  act(() => {
    el.click();
  });
};

/** Finds an input by its <label for> text. */
const byLabel = (text: string): HTMLInputElement | null => {
  const label = Array.from(container.querySelectorAll("label")).find(
    (el) => el.textContent?.trim() === text,
  );
  const id = label?.getAttribute("for");
  return id ? (container.querySelector(`[id="${id}"]`) as HTMLInputElement | null) : null;
};

const row = (name: string) =>
  container.querySelector(`fieldset[data-day="${name}"]`) as HTMLFieldSetElement | null;

const rows = () =>
  Array.from(container.querySelectorAll<HTMLFieldSetElement>("fieldset.oh-day-group"));

const summary = () => container.querySelector('[role="status"]')?.textContent;

const typeTime = (input: HTMLInputElement, time: string) => {
  act(() => {
    input.value = time;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** Switches to one row per day (no value change when the hours already fit). */
const showEachDay = () => click(radio("Different each day"));

/** Moves focus out of a row, as tabbing to the next row would. */
const leave = (el: HTMLElement) => {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  });
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

describe("OpeningHoursInput: step 1 (are the hours known?)", () => {
  it("offers Don't know, Open 24/7 and Set the hours, with Don't know selected for null", () => {
    renderInput(null);
    expect(radio("Don't know").checked).toBe(true);
    expect(radio("Open 24/7").checked).toBe(false);
    expect(radio("Set the hours").checked).toBe(false);
    expect(rows()).toHaveLength(0);
    expect(container.textContent).not.toContain("How do the hours vary?");
    expect(summary()).toBe("Opening hours not known");
  });

  it("selects Open 24/7 when every day is 24 hours (any equal pair)", () => {
    const value = week(["00:00", "00:00"]);
    value[2] = ["12:00", "12:00"];
    renderInput(value);
    expect(radio("Open 24/7").checked).toBe(true);
    expect(rows()).toHaveLength(0);
    expect(summary()).toBe("Open 24 hours, every day");
  });

  it("emits 24 hours every day when choosing Open 24/7", () => {
    const onChange = renderInput(null);
    click(radio("Open 24/7"));
    expect(onChange).toHaveBeenCalledWith(week(["00:00", "00:00"]));
  });

  it("emits 09:00–17:00 every day and shows a single 'Every day' row for Set the hours", () => {
    const changes = renderControlled(null);
    click(radio("Set the hours"));
    expect(changes).toEqual([week(["09:00", "17:00"])]);
    expect(radio("Set the hours").checked).toBe(true);
    expect(radio("Same every day").checked).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(byLabel("Every day opening time")?.value).toBe("09:00");
    expect(summary()).toBe("Every day 9am–5pm");
  });

  it("emits null when choosing Don't know", () => {
    const onChange = renderInput(week(["09:00", "17:00"]));
    click(radio("Don't know"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("does not emit when re-selecting the current mode", () => {
    const onChange = renderInput(null);
    act(() => {
      radio("Don't know").dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switching from Open 24/7 to Set the hours starts from 9am–5pm", () => {
    const changes = renderControlled(week(["00:00", "00:00"]));
    click(radio("Set the hours"));
    expect(changes.at(-1)).toEqual(week(["09:00", "17:00"]));
    expect(rows()).toHaveLength(1);
  });
});

describe("OpeningHoursInput: step 2 (presets)", () => {
  it("opens existing hours on the simplest layout that shows them", () => {
    renderInput(week(["09:00", "17:00"]));
    expect(radio("Set the hours").checked).toBe(true);
    expect(radio("Same every day").checked).toBe(true);
    expect(rows().map((r) => r.dataset.day)).toEqual(["Every day"]);
    expect(byLabel("Every day opening time")?.value).toBe("09:00");

    act(() => render(null, container));
    renderInput(weekdaysWeekend);
    expect(radio("Weekdays + weekends").checked).toBe(true);
    expect(rows().map((r) => r.dataset.day)).toEqual(["Monday to Friday", "Saturday and Sunday"]);
    expect(byLabel("Saturday and Sunday opening time")?.value).toBe("10:00");
  });

  it("falls back to the next simplest layout when new hours no longer fit", () => {
    renderInput(week(["09:00", "17:00"]));
    expect(rows()).toHaveLength(1);
    renderInput(weekdaysWeekend);
    expect(radio("Weekdays + weekends").checked).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it("opens differing hours with one row per day", () => {
    renderInput(variedWeek());
    expect(radio("Different each day").checked).toBe(true);
    expect(rows().map((r) => r.dataset.day)).toEqual(DAY_NAMES);
    expect(byLabel("Monday opening time")?.value).toBe("09:00");
  });

  it("Same every day collapses matching days without emitting", () => {
    const changes = renderControlled(week(["08:00", "18:00"]));
    click(radio("Same every day"));
    expect(changes).toEqual([]);
    expect(rows()).toHaveLength(1);
    expect(byLabel("Every day closing time")?.value).toBe("18:00");
  });

  it("Same every day copies the first open day to every day when they differ", () => {
    const value: OpeningTimes = [[], ["07:00", "19:00"], [], ["10:00", "12:00"], [], [], []];
    const changes = renderControlled(value);
    click(radio("Same every day"));
    expect(changes).toEqual([week(["07:00", "19:00"])]);
    expect(rows()).toHaveLength(1);
  });

  it("editing the Every day row changes all seven days", () => {
    const changes = renderControlled(null);
    click(radio("Set the hours"));
    typeTime(byLabel("Every day closing time") as HTMLInputElement, "20:30");
    expect(changes.at(-1)).toEqual(week(["09:00", "20:30"]));
    expect(summary()).toBe("Every day 9am–8:30pm");
  });

  it("Weekdays + weekends shows two rows and edits each group", () => {
    const changes = renderControlled(null);
    click(radio("Set the hours"));
    click(radio("Weekdays + weekends"));
    // Already fits (every day the same), so nothing new is emitted.
    expect(changes).toHaveLength(1);
    expect(rows().map((r) => r.dataset.day)).toEqual(["Monday to Friday", "Saturday and Sunday"]);

    const weekend = row("Saturday and Sunday") as HTMLFieldSetElement;
    click(radio("Closed", weekend));
    expect(changes.at(-1)).toEqual([...week(["09:00", "17:00"]).slice(0, 5), [], []]);
    expect(summary()).toBe("Mon–Fri 9am–5pm · Sat–Sun closed");

    typeTime(byLabel("Monday to Friday opening time") as HTMLInputElement, "07:30");
    expect(changes.at(-1)).toEqual([...week(["07:30", "17:00"]).slice(0, 5), [], []]);
  });

  it("Weekdays + weekends merges differing days into the two groups", () => {
    const value: OpeningTimes = [
      ["09:00", "17:00"],
      ["08:00", "18:00"],
      ["09:00", "17:00"],
      ["09:00", "17:00"],
      ["09:00", "17:00"],
      [],
      ["10:00", "16:00"],
    ];
    const onChange = renderInput(value);
    click(radio("Weekdays + weekends"));
    expect(onChange).toHaveBeenCalledWith([
      ...week(["09:00", "17:00"]).slice(0, 5),
      ["10:00", "16:00"],
      ["10:00", "16:00"],
    ]);
  });

  it("Different each day shows seven rows without changing the value", () => {
    const changes = renderControlled(null);
    click(radio("Set the hours"));
    click(radio("Different each day"));
    expect(changes).toHaveLength(1);
    expect(rows()).toHaveLength(7);
    typeTime(byLabel("Wednesday opening time") as HTMLInputElement, "11:00");
    const last = changes.at(-1) as OpeningTimes;
    expect(last[2]).toEqual(["11:00", "17:00"]);
    expect(last[1]).toEqual(["09:00", "17:00"]);
    expect(summary()).toBe("Mon–Tue 9am–5pm · Wed 11am–5pm · Thu–Sun 9am–5pm");
  });

  it("making the days match in Different each day keeps the seven rows", () => {
    const value = week(["09:00", "17:00"]);
    value[0] = ["10:00", "17:00"];
    renderControlled(value);
    typeTime(byLabel("Monday opening time") as HTMLInputElement, "09:00");
    expect(rows()).toHaveLength(7);
  });
});

describe("OpeningHoursInput: step 3 (day rows)", () => {
  it("each row offers Closed, Open and 24 hours", () => {
    renderInput(week(["09:00", "17:00"]));
    showEachDay();
    const monday = row("Monday") as HTMLFieldSetElement;
    expect(radio("Open", monday).checked).toBe(true);
    expect(radio("Closed", monday).checked).toBe(false);
    expect(radio("24 hours", monday).checked).toBe(false);
  });

  it("24 hours emits 00:00–00:00 for that day only and hides the times", () => {
    const changes = renderControlled(week(["09:00", "17:00"]));
    showEachDay();
    click(radio("24 hours", row("Wednesday") as HTMLFieldSetElement));
    const emitted = changes.at(-1) as OpeningTimes;
    expect(emitted[2]).toEqual(["00:00", "00:00"]);
    emitted.forEach((day, index) => {
      if (index !== 2) expect(day).toEqual(["09:00", "17:00"]);
    });
    expect(byLabel("Wednesday opening time")).toBeNull();
    expect(byLabel("Tuesday opening time")).not.toBeNull();
  });

  it("treats any equal pair as 24 hours", () => {
    renderInput([["12:00", "12:00"], [], [], [], [], [], ["09:00", "17:00"]]);
    expect(radio("24 hours", row("Monday") as HTMLFieldSetElement).checked).toBe(true);
    expect(byLabel("Monday opening time")).toBeNull();
  });

  it("treats a stored 00:00–24:00 as 24 hours", () => {
    const value = variedWeek();
    value[0] = ["00:00", "24:00"];
    renderInput(value);
    expect(radio("24 hours", row("Monday") as HTMLFieldSetElement).checked).toBe(true);
    expect(byLabel("Monday opening time")).toBeNull();
    act(() => render(null, container));
    renderInput(week(["00:00", "24:00"]));
    expect(radio("Open 24/7").checked).toBe(true);
  });

  it("Open after 24 hours or Closed restores 09:00–17:00", () => {
    const value = week(["09:00", "17:00"]);
    value[4] = ["00:00", "00:00"];
    value[6] = [];
    const onChange = renderInput(value);
    click(radio("Open", row("Friday") as HTMLFieldSetElement));
    expect((onChange.mock.calls[0][0] as OpeningTimes)[4]).toEqual(["09:00", "17:00"]);
    click(radio("Open", row("Sunday") as HTMLFieldSetElement));
    expect((onChange.mock.calls[1][0] as OpeningTimes)[6]).toEqual(["09:00", "17:00"]);
  });

  it("Closed emits an empty day and removes the time inputs", () => {
    const changes = renderControlled(week(["08:00", "18:00"]));
    showEachDay();
    click(radio("Closed", row("Sunday") as HTMLFieldSetElement));
    expect((changes.at(-1) as OpeningTimes)[6]).toEqual([]);
    expect(row("Sunday")?.querySelector('input[type="time"]')).toBeNull();
    expect(summary()).toBe("Mon–Sat 8am–6pm · Sun closed");
  });

  it("emits the edited time for the right day and position", () => {
    const onChange = renderInput(week(["09:00", "17:00"]));
    showEachDay();
    typeTime(byLabel("Tuesday closing time") as HTMLInputElement, "19:45");
    const emitted = onChange.mock.calls[0][0] as OpeningTimes;
    expect(emitted[1]).toEqual(["09:00", "19:45"]);
    expect(emitted[0]).toEqual(["09:00", "17:00"]);
  });

  it("allows overnight ranges and explains them", () => {
    const value = week(["09:00", "17:00"]);
    value[4] = ["22:00", "06:00"];
    renderInput(value);
    const close = byLabel("Friday closing time") as HTMLInputElement;
    const note = container.querySelector(`[id="${close.getAttribute("aria-describedby")}"]`);
    expect(note?.textContent).toBe("Closes the next morning");
    expect(byLabel("Monday closing time")?.hasAttribute("aria-describedby")).toBe(false);
    expect(summary()).toBe("Mon–Thu 9am–5pm · Fri 10pm–6am · Sat–Sun 9am–5pm");
  });

  it("shows a stored 24:00 closing time as midnight in the time input", () => {
    const value = week(["09:00", "17:00"]);
    value[0] = ["18:00", "24:00"];
    const onChange = renderInput(value);
    const close = byLabel("Monday closing time") as HTMLInputElement;
    expect(close.value).toBe("00:00");
    // Editing the other end keeps the stored 24:00.
    typeTime(byLabel("Monday opening time") as HTMLInputElement, "19:00");
    expect((onChange.mock.calls[0][0] as OpeningTimes)[0]).toEqual(["19:00", "24:00"]);
  });
});

describe("OpeningHoursInput: controlled", () => {
  it("re-rendering with a new value updates times, statuses and the summary", () => {
    const onChange = vi.fn();
    renderInput(week(["09:00", "17:00"]), onChange);
    expect(byLabel("Every day opening time")?.value).toBe("09:00");

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
    expect(radio("24 hours", row("Monday") as HTMLFieldSetElement).checked).toBe(true);
    expect(radio("Closed", row("Wednesday") as HTMLFieldSetElement).checked).toBe(true);
    expect(byLabel("Tuesday opening time")?.value).toBe("07:00");
    expect(byLabel("Thursday closing time")?.value).toBe("16:00");
    expect(byLabel("Sunday opening time")?.value).toBe("11:00");
    expect(summary()).toBe(
      "Mon open 24 hours · Tue 7am–7pm · Wed closed · Thu 10am–4pm · Fri open 24 hours · Sat closed · Sun 11am–3pm",
    );

    renderInput(null, onChange);
    expect(rows()).toHaveLength(0);
    expect(radio("Don't know").checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to one row per day when a new value no longer fits the layout", () => {
    const onChange = vi.fn();
    renderInput(null, onChange);
    // Parent supplies hours that are the same every day: shown as one row.
    renderInput(week(["09:00", "17:00"]), onChange);
    expect(rows()).toHaveLength(1);
    // Parent replaces them with differing days: every day is shown.
    renderInput([...week(["09:00", "17:00"]).slice(0, 6), []], onChange);
    expect(rows()).toHaveLength(7);
    expect(radio("Different each day").checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays on Set the hours when every day is made 24 hours one by one", () => {
    renderControlled(null);
    click(radio("Set the hours"));
    click(radio("24 hours", row("Every day") as HTMLFieldSetElement));
    expect(radio("Set the hours").checked).toBe(true);
    expect(rows()).toHaveLength(1);
  });

  it("does not mutate the value passed in", () => {
    const value = week(["09:00", "17:00"]);
    renderInput(value);
    showEachDay();
    click(radio("Closed", row("Monday") as HTMLFieldSetElement));
    typeTime(byLabel("Tuesday opening time") as HTMLInputElement, "06:00");
    expect(value).toEqual(week(["09:00", "17:00"]));
  });
});

describe("OpeningHoursInput: accessibility", () => {
  it("gives each day row a fieldset and legend, and labels every control", () => {
    renderInput(week(["09:00", "17:00"]));
    showEachDay();
    const groups = rows();
    expect(groups).toHaveLength(7);
    groups.forEach((group) => {
      const legend = group.querySelector("legend");
      expect(legend?.textContent).toBe(group.dataset.day);
      const radios = group.querySelectorAll('input[type="radio"]');
      expect(radios).toHaveLength(3);
      // Each row's radios form their own group.
      expect(new Set(Array.from(radios).map((r) => (r as HTMLInputElement).name)).size).toBe(1);
    });
    const names = new Set(groups.map((g) => (g.querySelector("input") as HTMLInputElement).name));
    expect(names.size).toBe(7);
    for (const input of container.querySelectorAll('input[type="time"]')) {
      const label = container.querySelector(`label[for="${input.id}"]`);
      expect(label?.textContent).toMatch(/(opening|closing) time$/);
    }
  });

  it("puts the first question and the preset question in fieldsets with legends", () => {
    renderInput(week(["09:00", "17:00"]));
    const legends = Array.from(container.querySelectorAll("fieldset > legend")).map(
      (l) => l.textContent,
    );
    expect(legends.slice(0, 2)).toEqual(["Opening hours", "How do the hours vary?"]);
  });

  it("announces the summary in a status region at the top", () => {
    renderInput([...week(["09:00", "17:00"]).slice(0, 5), ["10:00", "16:00"], []]);
    const status = container.querySelector('[role="status"]');
    expect(status).toBe(container.querySelector(".oh-input")?.firstElementChild);
    expect(status?.textContent).toBe("Mon–Fri 9am–5pm · Sat 10am–4pm · Sun closed");
  });

  it("links the error to the first question and marks invalid time inputs", () => {
    const value = week(["09:00", "17:00"]);
    value[1] = ["09:00", ""];
    renderInput(value, vi.fn(), {
      error: "Enter both opening and closing times for Tuesday.",
      id: "hours",
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Enter both opening and closing times for Tuesday.");
    const group = container.querySelector("#hours") as HTMLFieldSetElement;
    expect(group.tagName).toBe("FIELDSET");
    expect(group.getAttribute("aria-describedby")).toBe(alert?.id);
    expect(group.tabIndex).toBe(-1);
    expect(byLabel("Tuesday closing time")?.getAttribute("aria-invalid")).toBe("true");
    expect(byLabel("Tuesday opening time")?.hasAttribute("aria-invalid")).toBe(false);
    expect(byLabel("Monday closing time")?.hasAttribute("aria-invalid")).toBe(false);
  });

  it("the id target can receive focus for an error summary link", () => {
    renderInput(null, vi.fn(), { id: "hours" });
    const group = container.querySelector("#hours") as HTMLElement;
    group.focus();
    expect(document.activeElement).toBe(group);
  });

  it("omits tabindex and describedby when there is no id or error", () => {
    renderInput(null);
    const group = container.querySelector("fieldset") as HTMLFieldSetElement;
    expect(group.hasAttribute("tabindex")).toBe(false);
    expect(group.hasAttribute("aria-describedby")).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("OpeningHoursInput: undoable switches", () => {
  it("brings back the custom hours after Don't know or Open 24/7", () => {
    const changes = renderControlled(variedWeek());
    click(radio("Don't know"));
    expect(changes.at(-1)).toBeNull();
    click(radio("Set the hours"));
    expect(changes.at(-1)).toEqual(variedWeek());
    expect(radio("Different each day").checked).toBe(true);
    expect(rows()).toHaveLength(7);

    click(radio("Open 24/7"));
    expect(changes.at(-1)).toEqual(week(["00:00", "00:00"]));
    click(radio("Set the hours"));
    expect(changes.at(-1)).toEqual(variedWeek());
    expect(byLabel("Friday opening time")?.value).toBe("22:00");
  });

  it("restores edited hours on the layout that fits them", () => {
    const changes = renderControlled(null);
    click(radio("Set the hours"));
    click(radio("Weekdays + weekends"));
    click(radio("Closed", row("Saturday and Sunday") as HTMLFieldSetElement));
    const edited = changes.at(-1);
    click(radio("Don't know"));
    click(radio("Set the hours"));
    expect(changes.at(-1)).toEqual(edited);
    expect(radio("Weekdays + weekends").checked).toBe(true);
  });

  it("switching back to Different each day undoes a merge made by a simpler layout", () => {
    const changes = renderControlled(variedWeek());
    click(radio("Same every day"));
    expect(changes.at(-1)).toEqual(week(["09:00", "17:00"]));
    click(radio("Different each day"));
    expect(changes.at(-1)).toEqual(variedWeek());
    expect(rows()).toHaveLength(7);

    // Through two merges in a row.
    click(radio("Weekdays + weekends"));
    click(radio("Same every day"));
    click(radio("Different each day"));
    expect(changes.at(-1)).toEqual(variedWeek());
  });

  it("does not undo a merge once the merged hours have been edited", () => {
    const changes = renderControlled(variedWeek());
    click(radio("Same every day"));
    typeTime(byLabel("Every day closing time") as HTMLInputElement, "18:00");
    const count = changes.length;
    click(radio("Different each day"));
    expect(changes).toHaveLength(count);
    expect(rows()).toHaveLength(7);
    expect(byLabel("Friday closing time")?.value).toBe("18:00");
  });

  it("a row set to Closed or 24 hours gets its own times back when set to Open", () => {
    const changes = renderControlled(variedWeek());
    const thursday = () => row("Thursday") as HTMLFieldSetElement;
    click(radio("Closed", thursday()));
    expect((changes.at(-1) as OpeningTimes)[3]).toEqual([]);
    click(radio("Open", thursday()));
    expect((changes.at(-1) as OpeningTimes)[3]).toEqual(["10:00", "16:00"]);
    click(radio("24 hours", thursday()));
    click(radio("Open", thursday()));
    expect((changes.at(-1) as OpeningTimes)[3]).toEqual(["10:00", "16:00"]);
  });
});

describe("OpeningHoursInput: matching times while typing", () => {
  it("keeps the row open with its inputs when the times briefly match", () => {
    const changes = renderControlled(variedWeek());
    const open = byLabel("Monday opening time") as HTMLInputElement;
    // 09:00 → 17:00 on the way to 07:00: the pair matches the closing time.
    typeTime(open, "17:00");
    expect((changes.at(-1) as OpeningTimes)[0]).toEqual(["17:00", "17:00"]);
    const monday = row("Monday") as HTMLFieldSetElement;
    expect(radio("Open", monday).checked).toBe(true);
    expect(byLabel("Monday opening time")).toBe(open);
    expect(open.isConnected).toBe(true);
    const noteId = (byLabel("Monday closing time") as HTMLInputElement).getAttribute(
      "aria-describedby",
    );
    expect(container.querySelector(`[id="${noteId}"]`)?.textContent).toMatch(
      /same, so this counts as open 24 hours/,
    );

    typeTime(open, "07:00");
    expect((changes.at(-1) as OpeningTimes)[0]).toEqual(["07:00", "17:00"]);
    expect(radio("Open", monday).checked).toBe(true);
    expect(container.textContent).not.toContain("counts as open 24 hours");
  });

  it("shows matching times as 24 hours once focus leaves the row", () => {
    renderControlled(variedWeek());
    typeTime(byLabel("Monday closing time") as HTMLInputElement, "09:00");
    const monday = row("Monday") as HTMLFieldSetElement;
    expect(radio("Open", monday).checked).toBe(true);
    leave(monday);
    expect(radio("24 hours", monday).checked).toBe(true);
    expect(byLabel("Monday opening time")).toBeNull();
  });

  it("stays on Set the hours when the only row's times match", () => {
    renderControlled(week(["09:00", "17:00"]));
    typeTime(byLabel("Every day opening time") as HTMLInputElement, "17:00");
    expect(radio("Set the hours").checked).toBe(true);
    expect(byLabel("Every day opening time")).not.toBeNull();
    leave(row("Every day") as HTMLFieldSetElement);
    expect(radio("Set the hours").checked).toBe(true);
    expect(radio("24 hours", row("Every day") as HTMLFieldSetElement).checked).toBe(true);
  });
});

describe("OpeningHoursInput: errors", () => {
  it("names the visible row in the message when days are grouped", () => {
    const value: OpeningTimes = [
      ...week(["08:00", ""]).slice(0, 5),
      ["10:00", "16:00"],
      ["10:00", "16:00"],
    ];
    renderInput(value, vi.fn(), { error: "Enter both opening and closing times for Monday." });
    expect(radio("Weekdays + weekends").checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter both opening and closing times for Monday to Friday.",
    );

    act(() => render(null, container));
    renderInput(week(["08:00", ""]), vi.fn(), {
      error: "Enter both opening and closing times for Monday.",
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter both opening and closing times for every day.",
    );
  });

  it("shows other errors as given", () => {
    renderInput(variedWeek(), vi.fn(), { error: "Something went wrong with the hours." });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Something went wrong with the hours.",
    );
  });

  it("marks the first invalid time input for the form to focus, and links it to the error", () => {
    const value = variedWeek();
    value[1] = ["08:00", ""];
    value[3] = ["", "16:00"];
    renderInput(value, vi.fn(), { error: "x", id: "hours" });
    const marked = container.querySelectorAll('[data-first-invalid-for="hours"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(byLabel("Tuesday closing time"));
    expect(byLabel("Thursday opening time")?.getAttribute("aria-invalid")).toBe("true");
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toBe("Enter both opening and closing times for Tuesday.");
    expect(marked[0].getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(byLabel("Tuesday opening time")?.hasAttribute("aria-describedby")).toBe(false);

    renderInput(value, vi.fn(), { id: "hours" });
    expect(container.querySelector("[data-first-invalid-for]")).toBeNull();
  });
});
