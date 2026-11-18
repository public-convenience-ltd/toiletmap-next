import { render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { hasSessionCookie, siteNavLinks } from "../../utils/siteNav";
import SiteHeader from "./SiteHeader";

/** Sets a cookie the way the browser would see the sign-in's non-httpOnly `user_info`. */
const setCookie = (value: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: the component reads document.cookie; tests set it
  document.cookie = value;
};

const clearCookies = () => {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) setCookie(`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`);
  }
};

afterEach(() => {
  clearCookies();
});

/** The desktop menu's links (the drawer has the same ones). */
const navHrefs = () =>
  [...document.querySelectorAll(".header__larger-devices a")].map((a) => a.getAttribute("href"));

describe("siteNavLinks", () => {
  it("is the one nav list: blog at /posts, add a toilet, then sign in or out", () => {
    expect(siteNavLinks({ isAuthenticated: false, signInHref: "/auth/login" })).toEqual([
      { href: "/about", label: "About" },
      { href: "/posts", label: "Blog" },
      { href: "/contact", label: "Contact" },
      { href: "/feedback", label: "Feedback" },
      { href: "/loos/add", label: "Add a toilet", button: true },
      { href: "/auth/login", label: "Sign in" },
    ]);
    expect(siteNavLinks({ isAuthenticated: true, signInHref: "/auth/login" }).at(-1)).toEqual({
      href: "/auth/logout",
      label: "Sign out",
    });
  });
});

describe("hasSessionCookie", () => {
  it("looks for a non-empty user_info cookie", () => {
    expect(hasSessionCookie("a=1; user_info=%7B%7D; b=2")).toBe(true);
    expect(hasSessionCookie("user_info=")).toBe(false);
    expect(hasSessionCookie("not_user_info=x")).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie(undefined)).toBe(false);
  });
});

describe("SiteHeader", () => {
  it("uses the server's sign-in state when given", () => {
    setCookie("user_info=%7B%7D; path=/");
    render(
      <SiteHeader
        logoSrc="/logo.svg"
        isAuthenticated={false}
        signInHref="/auth/login?returnTo=%2F"
      />,
    );
    expect(navHrefs()).toContain("/auth/login?returnTo=%2F");
    expect(navHrefs()).not.toContain("/auth/logout");
  });

  it("reads the session cookie itself on prerendered pages (no server state)", async () => {
    setCookie("user_info=%7B%7D; path=/");
    render(<SiteHeader logoSrc="/logo.svg" signInHref="/auth/login" />);
    expect(await screen.findAllByRole("link", { name: "Sign out" })).not.toHaveLength(0);
    expect(navHrefs()).toContain("/auth/logout");
  });

  it("shows Sign in when there is no session", () => {
    render(<SiteHeader logoSrc="/logo.svg" signInHref="/auth/login" />);
    expect(navHrefs()).toContain("/auth/login");
    expect(navHrefs()).toContain("/posts");
  });

  it("passes drawer links to the small-screen menu", () => {
    render(
      <SiteHeader
        logoSrc="/logo.svg"
        isAuthenticated
        signInHref="/auth/login"
        drawerLinks={[{ href: "/privacy", label: "Privacy Policy" }]}
      />,
    );
    expect(
      [...document.querySelectorAll(".header__smaller-devices a")].map((a) =>
        a.getAttribute("href"),
      ),
    ).toContain("/privacy");
  });

  describe("sign-in follows the page", () => {
    const originalPath = `${window.location.pathname}${window.location.search}`;
    afterEach(() => {
      window.history.replaceState(null, "", originalPath);
    });

    const signInLinks = () =>
      [...document.querySelectorAll<HTMLAnchorElement>("a")].filter((a) =>
        (a.getAttribute("href") ?? "").startsWith("/auth/login"),
      );

    it("returns to the page the browser is on, as the map changes the URL", () => {
      window.history.replaceState(null, "", "/");
      render(
        <SiteHeader
          logoSrc="/logo.svg"
          isAuthenticated={false}
          signInHref="/auth/login?returnTo=%2F"
          signInFollowsPage
        />,
      );
      expect(navHrefs()).toContain("/auth/login?returnTo=%2F");

      // The map selects a toilet: the URL changes without a reload.
      window.history.pushState(null, "", "/loos/abc?x=1");
      const link = signInLinks()[0];
      if (!link) throw new Error("no sign-in link");
      // Keep the test page where it is.
      const stop = (event: Event) => event.preventDefault();
      document.addEventListener("click", stop);
      link.click();
      document.removeEventListener("click", stop);
      expect(link.getAttribute("href")).toBe(
        `/auth/login?returnTo=${encodeURIComponent("/loos/abc?x=1")}`,
      );
    });

    it("keeps a fixed returnTo when the page chose one", () => {
      window.history.replaceState(null, "", "/somewhere");
      render(<SiteHeader logoSrc="/logo.svg" isAuthenticated={false} signInHref="/auth/login" />);
      expect(navHrefs()).toContain("/auth/login");
      expect(navHrefs()).not.toContain(`/auth/login?returnTo=${encodeURIComponent("/somewhere")}`);
    });
  });
});
