import { render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_MESSAGES, RATE_LIMITED_MESSAGE, VERIFICATION_MESSAGE } from "../../api/feedback";
import FeedbackForm, {
  FEEDBACK_INTRO_ATTRIBUTE,
  FEEDBACK_TITLES,
  type FeedbackFormProps,
} from "./FeedbackForm";

const ID = "0123456789abcdef01234567";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, message: "Thank you" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.title = "";
  for (const intro of document.querySelectorAll(`[${FEEDBACK_INTRO_ATTRIBUTE}]`)) intro.remove();
});

const setup = (props: Partial<FeedbackFormProps> = {}) => {
  const user = userEvent.setup();
  render(<FeedbackForm apiUrl="" {...props} />);
  return user;
};

const message = () => screen.getByRole("textbox", { name: "Your message" });
const email = () => screen.getByRole("textbox", { name: "Email address (optional)" });
const send = () => screen.getByRole("button", { name: "Send feedback" });

/** The JSON bodies posted to /api/feedback. */
const posted = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: (init as RequestInit).method,
    body: JSON.parse((init as RequestInit).body as string),
  }));

const summary = () => screen.getByRole("heading", { name: "There's a problem" }).closest(".notice");

describe("FeedbackForm — fields", () => {
  it("labels both fields, marks the message required and the email optional", () => {
    setup();
    expect(message()).toBeRequired();
    expect(message()).toHaveAttribute("name", "text");
    expect(message()).toHaveAttribute("maxlength", "5000");
    expect(message()).toHaveClass("text-area");
    expect(email()).not.toBeRequired();
    expect(email()).toHaveAttribute("type", "email");
    expect(email()).toHaveAttribute("autocomplete", "email");
    expect(email()).toHaveClass("input");
  });

  it("says how the email address is used, in the field's description", () => {
    setup();
    const description = email().getAttribute("aria-describedby") ?? "";
    const hint = document.getElementById(description.split(" ")[0] ?? "");
    expect(hint).toHaveTextContent(/Only if you'd like a reply/);
    // No retention period: nothing enforces one (and the privacy policy doesn't give one).
    expect(hint).not.toHaveTextContent(/months/);
    expect(hint).toHaveTextContent(/never shared or posted to our team chat/);
    expect(
      within(hint as HTMLElement).getByRole("link", { name: "privacy policy" }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("is a real form post to /feedback, so it works before (or without) JavaScript", () => {
    setup();
    const form = send().closest("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/feedback");
    expect(send()).toHaveAttribute("type", "submit");
  });
});

describe("FeedbackForm — validation", () => {
  it("needs a message: error summary first, linked to the field, nothing sent", async () => {
    const user = setup();
    await user.click(send());
    const box = summary();
    expect(box).toHaveClass("notice--error");
    await waitFor(() => expect(box?.parentElement).toHaveFocus());
    const link = within(box as HTMLElement).getByRole("link", {
      name: ERROR_MESSAGES.textRequired,
    });
    expect(link).toHaveAttribute("href", "#feedback-text");
    // Inline by the field too.
    expect(screen.getAllByText(ERROR_MESSAGES.textRequired)).toHaveLength(2);
    expect(message()).toHaveAttribute("aria-invalid", "true");
    expect(message().getAttribute("aria-describedby")).toContain("feedback-text-error");
    await user.click(link);
    expect(message()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a message of only spaces as empty", async () => {
    const user = setup();
    await user.type(message(), "    ");
    await user.click(send());
    expect(screen.getAllByText(ERROR_MESSAGES.textRequired)).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the email address only when there is one", async () => {
    const user = setup();
    await user.type(message(), "The map is great");
    await user.type(email(), "not an email");
    await user.click(send());
    const link = within(summary() as HTMLElement).getByRole("link", {
      name: ERROR_MESSAGES.emailInvalid,
    });
    expect(link).toHaveAttribute("href", "#feedback-email");
    expect(email()).toHaveAttribute("aria-invalid", "true");
    expect(message()).not.toHaveAttribute("aria-invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists every problem in page order", async () => {
    const user = setup();
    await user.type(email(), "a@b");
    await user.click(send());
    const items = within(summary() as HTMLElement).getAllByRole("link");
    expect(items.map((a) => a.getAttribute("href"))).toEqual(["#feedback-text", "#feedback-email"]);
  });
});

describe("FeedbackForm — sending", () => {
  it("posts the trimmed message and email as JSON to the /api proxy, then thanks you", async () => {
    const user = setup();
    await user.type(message(), "  Please add more toilets in Leeds  ");
    await user.type(email(), " someone@example.com ");
    await user.click(send());
    const thanks = await screen.findByText("Thank you, your message has been sent");
    expect(posted()).toEqual([
      {
        url: "/api/feedback",
        method: "POST",
        body: {
          text: "Please add more toilets in Leeds",
          email: "someone@example.com",
          route: "/feedback",
        },
      },
    ]);
    await waitFor(() => expect(thanks.closest("[tabindex='-1']")).toHaveFocus());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the map" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Send another message" })).toHaveAttribute(
      "href",
      "/feedback",
    );
  });

  it("sends an empty email as none", async () => {
    const user = setup();
    await user.type(message(), "Hello");
    await user.click(send());
    await screen.findByText("Thank you, your message has been sent");
    expect(posted()[0]?.body).toEqual({ text: "Hello", email: "", route: "/feedback" });
  });

  it("says 'Sending…' and ignores more clicks while it sends", async () => {
    let resolve: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolve = r)));
    const user = setup();
    await user.type(message(), "Hello");
    await user.click(send());
    const busy = screen.getByRole("button", { name: "Sending…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(jsonResponse(200, { ok: true }));
    await screen.findByText("Thank you, your message has been sent");
  });

  it("explains a rate limit kindly and keeps the message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { message: "Too many requests" }));
    const user = setup();
    await user.type(message(), "Hello again");
    await user.click(send());
    const error = await screen.findByText(RATE_LIMITED_MESSAGE);
    expect(screen.getByRole("heading", { name: "Your message wasn't sent" })).toBeInTheDocument();
    await waitFor(() => expect(error.closest("[tabindex='-1']")).toHaveFocus());
    expect(message()).toHaveValue("Hello again");
    expect(screen.queryByText("Too many requests")).not.toBeInTheDocument();
  });

  it("says when the server fails, without its own wording, and can send again", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: "Could not save" }));
    const user = setup();
    await user.type(message(), "Hello");
    await user.click(send());
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.queryByText("Could not save")).not.toBeInTheDocument();
    await user.click(send());
    await screen.findByText("Thank you, your message has been sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("offers another way to get in touch when a send fails, but not for a rate limit", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: "Could not save" }));
    const user = setup();
    await user.type(message(), "Hello");
    await user.click(send());
    const link = await screen.findByRole("link", { name: "contact us another way" });
    expect(link).toHaveAttribute("href", "/contact");

    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}));
    await user.click(send());
    await screen.findByText(RATE_LIMITED_MESSAGE);
    expect(screen.queryByRole("link", { name: "contact us another way" })).not.toBeInTheDocument();
  });

  it("says when the server's Turnstile check refused the message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        message: "Please complete the verification",
        error: "turnstile_required",
      }),
    );
    const user = setup();
    await user.type(message(), "Hello");
    await user.click(send());
    expect(await screen.findByText(VERIFICATION_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong on our side/)).not.toBeInTheDocument();
  });

  it("titles the page as the server would: an error, then sent; and hides the introduction once sent", async () => {
    const intro = document.createElement("p");
    intro.setAttribute(FEEDBACK_INTRO_ATTRIBUTE, "");
    intro.textContent = "Tell us about a problem";
    document.body.appendChild(intro);
    document.title = FEEDBACK_TITLES.form;

    const user = setup();
    await user.click(send());
    await waitFor(() => expect(document.title).toBe(FEEDBACK_TITLES.failed));
    expect(intro.hidden).toBe(false);

    await user.type(message(), "Hello");
    await user.click(send());
    await screen.findByText("Thank you, your message has been sent");
    // Preact runs effects after paint.
    await waitFor(() => expect(document.title).toBe(FEEDBACK_TITLES.sent));
    expect(intro.hidden).toBe(true);
  });

  it("says when the network is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = setup();
    await user.type(message(), "Hello");
    await user.click(send());
    expect(await screen.findByText(/Check your connection/)).toBeInTheDocument();
  });

  it("puts a server-side field error on the field", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        message: "Invalid feedback",
        issues: { _errors: [], email: { _errors: ["Enter a valid email address"] } },
      }),
    );
    const user = setup();
    await user.type(message(), "Hello");
    await user.type(email(), "someone@example.c");
    await user.click(send());
    await waitFor(() => expect(email()).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getAllByText(ERROR_MESSAGES.emailInvalid)).toHaveLength(2);
  });
});

describe("FeedbackForm — about a toilet", () => {
  const loo = { id: ID, name: "High Street toilets" };

  it("names the toilet, links to it and carries its id in a hidden field", () => {
    setup({ loo });
    expect(screen.getByText("High Street toilets").closest("p")).toHaveTextContent(
      "Your message will be about High Street toilets.",
    );
    expect(screen.getByRole("link", { name: "View the toilet" })).toHaveAttribute(
      "href",
      `/loos/${ID}`,
    );
    const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"][name="loo"]');
    expect(hidden?.value).toBe(ID);
    expect(screen.getByRole("link", { name: "Back to the toilet" })).toHaveAttribute(
      "href",
      `/loos/${ID}`,
    );
  });

  it("says 'this toilet' when it has no name", () => {
    setup({ loo: { id: ID, name: null } });
    expect(screen.getByText("this toilet")).toBeInTheDocument();
  });

  it("stores the toilet's page as the message's route, and links back after sending", async () => {
    const user = setup({ loo });
    await user.type(message(), "The opening hours sign says 8 till 6");
    await user.click(send());
    await screen.findByText("Thank you, your message has been sent");
    expect(posted()[0]?.body.route).toBe(`/loos/${ID}`);
    expect(screen.getByRole("link", { name: "Back to the toilet" })).toHaveAttribute(
      "href",
      `/loos/${ID}`,
    );
    expect(screen.getByRole("link", { name: "Send another message" })).toHaveAttribute(
      "href",
      `/feedback?loo=${ID}`,
    );
  });

  it("has no toilet context without one", () => {
    setup();
    expect(screen.queryByText(/Your message will be about/)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="hidden"]')).toBeNull();
  });
});

describe("FeedbackForm — after a form post without JavaScript", () => {
  it("shows what the server sent back: the values and the errors, with the summary focused", async () => {
    setup({
      initial: {
        text: "",
        email: "nope",
        errors: { text: ERROR_MESSAGES.textRequired, email: ERROR_MESSAGES.emailInvalid },
      },
    });
    expect(email()).toHaveValue("nope");
    const box = summary();
    expect(within(box as HTMLElement).getAllByRole("link")).toHaveLength(2);
    await waitFor(() => expect(box?.parentElement).toHaveFocus());
  });

  it("shows a send error with the message kept", async () => {
    setup({ initial: { text: "Hello", email: "", submitError: RATE_LIMITED_MESSAGE } });
    expect(message()).toHaveValue("Hello");
    const error = screen.getByText(RATE_LIMITED_MESSAGE);
    await waitFor(() => expect(error.closest("[tabindex='-1']")).toHaveFocus());
  });

  it("leaves the server's title alone when it first renders", () => {
    document.title = "Set by the server";
    setup({ initial: { text: "Hello", email: "", submitError: RATE_LIMITED_MESSAGE } });
    expect(document.title).toBe("Set by the server");
  });

  it("shows the thank-you state after the redirect, without moving focus", () => {
    setup({ initial: { sent: true } });
    const thanks = screen.getByText("Thank you, your message has been sent");
    expect(thanks.closest("[tabindex='-1']")).not.toHaveFocus();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
