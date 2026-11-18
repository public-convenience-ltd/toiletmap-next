import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog, { type ConfirmDialogProps } from "./ConfirmDialog";

let container: HTMLElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  opener = document.createElement("button");
  opener.textContent = "Open";
  document.body.appendChild(opener);
  opener.focus();
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  opener.remove();
});

type Props = Partial<ConfirmDialogProps>;

const renderDialog = (props: Props = {}) => {
  const handlers = {
    onConfirm: props.onConfirm ?? vi.fn(),
    onCancel: props.onCancel ?? vi.fn(),
  };
  act(() =>
    render(
      <ConfirmDialog
        open
        title="Discard your changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        {...props}
        {...handlers}
      >
        <p>You've made 2 changes that haven't been saved.</p>
      </ConfirmDialog>,
      container,
    ),
  );
  return handlers;
};

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');
const confirmButton = () =>
  document.querySelector<HTMLButtonElement>(".confirm-dialog__confirm") as HTMLButtonElement;
const cancelButton = () =>
  document.querySelector<HTMLButtonElement>(".confirm-dialog__cancel") as HTMLButtonElement;
const closeButton = () =>
  document.querySelector<HTMLButtonElement>(".confirm-dialog__close") as HTMLButtonElement;
const backdrop = () =>
  document.querySelector<HTMLElement>(".confirm-dialog__backdrop") as HTMLElement;
const key = (target: Element, k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
  });

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(dialog()).toBeNull();
  });

  it("is a modal alertdialog labelled by its title and described by its body", () => {
    renderDialog();
    const el = dialog() as HTMLElement;
    expect(el.getAttribute("role")).toBe("alertdialog");
    expect(el.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(el.getAttribute("aria-labelledby") ?? "");
    expect(title?.tagName).toBe("H2");
    expect(title?.textContent).toBe("Discard your changes?");
    const body = document.getElementById(el.getAttribute("aria-describedby") ?? "");
    expect(body?.textContent).toBe("You've made 2 changes that haven't been saved.");
  });

  it("can be a plain dialog", () => {
    renderDialog({ role: "dialog" });
    expect(dialog()?.getAttribute("role")).toBe("dialog");
  });

  it("renders into document.body by default, or in place", () => {
    renderDialog();
    expect(container.querySelector(".confirm-dialog")).toBeNull();
    expect(document.body.querySelector(":scope > .confirm-dialog")).not.toBeNull();
    renderDialog({ portal: false });
    expect(container.querySelector(".confirm-dialog")).not.toBeNull();
  });

  it("puts the primary first, then the secondary", () => {
    renderDialog();
    const labels = Array.from(document.querySelectorAll(".confirm-dialog__actions button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Discard changes", "Keep editing"]);
  });

  it("focuses the primary by default and the cancel button when destructive", () => {
    renderDialog();
    expect(document.activeElement).toBe(confirmButton());
    renderDialog({ open: false });
    renderDialog({ tone: "destructive" });
    expect(document.activeElement).toBe(cancelButton());
  });

  it("can focus either button, or an element of the caller's", () => {
    renderDialog({ initialFocus: "cancel" });
    expect(document.activeElement).toBe(cancelButton());
    renderDialog({ open: false });

    const ref = createRef<HTMLInputElement>();
    act(() =>
      render(
        <ConfirmDialog
          open
          title="Why?"
          confirmLabel="Send"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          initialFocus={ref}
          extra={<input ref={ref} aria-label="Reason" />}
        />,
        container,
      ),
    );
    expect(document.activeElement).toBe(ref.current);
  });

  it("can focus its title, so a dialog to read is not confirmed by a second Enter", () => {
    renderDialog({ initialFocus: "title" });
    const title = document.querySelector<HTMLElement>(".confirm-dialog__title");
    expect(document.activeElement).toBe(title);
    expect(title?.getAttribute("tabindex")).toBe("-1");
    renderDialog({ open: false });
    // Only then is the title focusable: Tab never stops on it otherwise.
    renderDialog();
    expect(document.querySelector(".confirm-dialog__title")?.hasAttribute("tabindex")).toBe(false);
  });

  it("makes a destructive primary red", () => {
    renderDialog({ tone: "destructive" });
    expect(confirmButton().classList.contains("button--destructive")).toBe(true);
    renderDialog({ open: false });
    renderDialog();
    expect(confirmButton().classList.contains("button--destructive")).toBe(false);
  });

  it("calls onConfirm and onCancel from their buttons", () => {
    const { onConfirm, onCancel } = renderDialog();
    act(() => confirmButton().click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    act(() => cancelButton().click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape, the backdrop and the close button (onDismiss, else onCancel)", () => {
    const { onCancel } = renderDialog();
    key(confirmButton(), "Escape");
    act(() => backdrop().click());
    act(() => closeButton().click());
    expect(onCancel).toHaveBeenCalledTimes(3);

    const onDismiss = vi.fn();
    const handlers = renderDialog({ onDismiss });
    key(confirmButton(), "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).not.toHaveBeenCalled();
    expect(closeButton().getAttribute("aria-label")).toBe("Close");
  });

  it("can ignore Escape and the backdrop, and hide the close button", () => {
    const { onCancel } = renderDialog({
      closeOnEscape: false,
      closeOnBackdrop: false,
      showCloseButton: false,
    });
    key(confirmButton(), "Escape");
    act(() => backdrop().click());
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector(".confirm-dialog__close")).toBeNull();
  });

  it("keeps Escape from reaching the page behind (e.g. a panel that collapses on Escape)", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    renderDialog();
    key(confirmButton(), "Escape");
    key(confirmButton(), "a");
    document.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
  });

  it("keeps focus in the dialog when the backdrop is pressed and the dialog stays open", () => {
    renderDialog({ closeOnBackdrop: false });
    expect(document.activeElement).toBe(confirmButton());
    // A press on the backdrop would blur the focused button (focus to the body): it doesn't.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      backdrop().dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    // Even if focus was lost some other way, the click puts it back in the dialog.
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    expect(document.activeElement).toBe(document.body);
    act(() => backdrop().click());
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("owns an Escape pressed with focus outside it (on the body), so the page behind never sees it", () => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    const { onCancel } = renderDialog();
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    key(document.body, "Escape");
    window.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores a body Escape while busy, still without letting it reach the page", () => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    const onCancel = vi.fn();
    renderDialog({ onConfirm: () => new Promise<void>(() => undefined), onCancel });
    act(() => confirmButton().click());
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    key(document.body, "Escape");
    window.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the dialog", () => {
    renderDialog({ showCloseButton: false });
    cancelButton().focus();
    key(cancelButton(), "Tab");
    expect(document.activeElement).toBe(confirmButton());
    key(confirmButton(), "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(cancelButton());
  });

  it("pulls focus back in if it leaves while the dialog stays open", async () => {
    renderDialog();
    await act(async () => {
      opener.focus();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("gives focus back to the opener when it closes", () => {
    renderDialog();
    expect(document.activeElement).not.toBe(opener);
    renderDialog({ open: false });
    expect(document.activeElement).toBe(opener);
  });

  it("leaves focus alone on close if the action moved it somewhere else", async () => {
    // As "Move the map" does: the cancel handler focuses the map, and the dialog closes.
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    renderDialog({ onCancel: () => elsewhere.focus() });
    act(() => cancelButton().click());
    renderDialog({ open: false });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("locks the page's scroll while open and restores it after", () => {
    document.body.style.overflow = "auto";
    renderDialog();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    renderDialog({ open: false });
    expect(document.body.style.overflow).toBe("auto");
    expect(document.documentElement.style.overflow).toBe("");
    document.body.style.overflow = "";
  });

  it("is busy while onConfirm's promise runs: buttons disabled, dismissal ignored", async () => {
    let resolve: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const onCancel = vi.fn();
    renderDialog({ onConfirm, onCancel, busyLabel: "Discarding…" });
    act(() => confirmButton().click());

    expect(dialog()?.getAttribute("aria-busy")).toBe("true");
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    expect(cancelButton().getAttribute("aria-disabled")).toBe("true");
    expect(confirmButton().textContent).toContain("Discarding…");
    expect(confirmButton().querySelector(".spin")).not.toBeNull();
    // Focus stays on the button (a disabled button would drop it).
    expect(document.activeElement).toBe(confirmButton());

    act(() => confirmButton().click());
    act(() => cancelButton().click());
    key(confirmButton(), "Escape");
    act(() => backdrop().click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(dialog()?.hasAttribute("aria-busy")).toBe(false);
    expect(confirmButton().hasAttribute("aria-disabled")).toBe(false);
    expect(confirmButton().textContent).toBe("Discard changes");
    expect(confirmButton().querySelector(".spin")).toBeNull();
  });

  it("comes back from busy when onConfirm's promise rejects", async () => {
    let reject: () => void = () => undefined;
    renderDialog({
      onConfirm: () =>
        new Promise<void>((_, r) => {
          reject = () => r(new Error("nope"));
        }),
    });
    act(() => confirmButton().click());
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      reject();
      await Promise.resolve();
    });
    expect(confirmButton().hasAttribute("aria-disabled")).toBe(false);
  });

  it("can be made busy from outside", () => {
    const { onConfirm } = renderDialog({ busy: true });
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    act(() => confirmButton().click());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
