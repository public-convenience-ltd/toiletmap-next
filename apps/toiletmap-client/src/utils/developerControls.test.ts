// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { developerPageResponse, showDeveloperControls } from "./developerControls";

describe("showDeveloperControls", () => {
  it("shows them in dev builds whatever the environment", () => {
    expect(showDeveloperControls("production", true)).toBe(true);
    expect(showDeveloperControls(undefined, true)).toBe(true);
  });

  it("shows them in deployed development and preview environments", () => {
    expect(showDeveloperControls("development", false)).toBe(true);
    expect(showDeveloperControls("preview", false)).toBe(true);
    expect(showDeveloperControls(" Preview ", false)).toBe(true);
  });

  it("hides them in production, and when the environment is unknown", () => {
    expect(showDeveloperControls("production", false)).toBe(false);
    expect(showDeveloperControls(undefined, false)).toBe(false);
    expect(showDeveloperControls(null, false)).toBe(false);
    expect(showDeveloperControls("staging", false)).toBe(false);
  });
});

describe("developerPageResponse", () => {
  it("lets the page render where the developer controls show", () => {
    expect(developerPageResponse("production", true)).toBeNull();
    expect(developerPageResponse("preview", false)).toBeNull();
    expect(developerPageResponse("development", false)).toBeNull();
  });

  it("is a body-less 404 in production and unknown environments (Astro then serves its 404)", async () => {
    for (const environment of ["production", undefined, "staging"]) {
      const response = developerPageResponse(environment, false);
      expect(response?.status, String(environment)).toBe(404);
      expect(await response?.text()).toBe("");
    }
  });
});

describe("developer-only pages", () => {
  const pages = {
    "/dev/components": readFileSync(
      new URL("../pages/dev/components.astro", import.meta.url),
      "utf8",
    ),
  };

  it.each(Object.entries(pages))(
    "%s returns the gate's 404 before rendering anything",
    (_, source) => {
      const frontmatter = source.split("---")[1] ?? "";
      expect(frontmatter).toMatch(
        /const blocked = developerPageResponse\(env\.ENVIRONMENT, import\.meta\.env\.DEV\);\s*if \(blocked\) return blocked;/,
      );
    },
  );

  it.each(Object.entries(pages))("%s is kept out of search engines", (_, source) => {
    expect(source).toMatch(/<meta slot="head" name="robots" content="noindex, nofollow" \/>/);
  });
});
