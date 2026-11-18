import { describe, expect, it } from "vitest";
import { withArticle } from "./KitchenSink";

describe("KitchenSink copy", () => {
  it("uses the right article for every tone's generated title", () => {
    expect(["info", "success", "warning", "error"].map(withArticle)).toEqual([
      "An info",
      "A success",
      "A warning",
      "An error",
    ]);
  });
});
