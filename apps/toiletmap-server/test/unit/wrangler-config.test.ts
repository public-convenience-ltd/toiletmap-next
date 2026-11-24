import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards for the two workers' wrangler.jsonc: previews must not share production's
 * rate-limit counters (L12, NEW-5: the Nominatim budget lives on RATE_LIMIT_ADMIN), and
 * production must not serve per-version preview URLs (L18).
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const readRepoFile = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

/** Removes // and /* *\/ comments outside strings, then trailing commas. */
const parseJsonc = (text: string): unknown => {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[++i] ?? "";
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += char;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
};

type RateLimit = { name: string; namespace_id: string };
type WorkerEnv = {
  name?: string;
  preview_urls?: boolean;
  workers_dev?: boolean;
  ratelimits?: RateLimit[];
};
type WranglerConfig = WorkerEnv & { env: Record<string, WorkerEnv> };

const serverConfig = parseJsonc(
  readRepoFile("apps/toiletmap-server/wrangler.jsonc"),
) as WranglerConfig;
const clientConfig = parseJsonc(
  readRepoFile("apps/toiletmap-client/wrangler.jsonc"),
) as WranglerConfig;

const namespaces = (env: WorkerEnv) =>
  Object.fromEntries((env.ratelimits ?? []).map((limit) => [limit.name, limit.namespace_id]));

describe("server rate-limit namespaces", () => {
  const production = namespaces(serverConfig.env.production);
  const preview = namespaces(serverConfig.env.preview);

  it("keeps the production namespace ids unchanged", () => {
    expect(production).toEqual({
      RATE_LIMIT_READ: "1000",
      RATE_LIMIT_WRITE: "1001",
      RATE_LIMIT_ADMIN: "1002",
      RATE_LIMIT_AUTH: "1003",
      RATE_LIMIT_ANON_WRITE: "1004",
    });
  });

  it("binds the same limiters in preview as in production", () => {
    expect(Object.keys(preview).sort()).toEqual(Object.keys(production).sort());
  });

  it("gives previews namespaces that production does not use (incl. the Nominatim budget)", () => {
    const productionIds = new Set(Object.values(production));
    for (const [name, id] of Object.entries(preview)) {
      expect(productionIds.has(id), `${name} shares namespace ${id} with production`).toBe(false);
    }
    expect(preview.RATE_LIMIT_ADMIN).not.toBe(production.RATE_LIMIT_ADMIN);
    expect(new Set(Object.values(preview)).size).toBe(Object.keys(preview).length);
  });
});

describe.each([
  ["toiletmap-server", serverConfig],
  ["toiletmap-client", clientConfig],
])("%s production worker", (workerName, config) => {
  it("is the production script name", () => {
    expect(config.env.production.name).toBe(workerName);
  });

  it("serves no per-version preview URLs", () => {
    expect(config.env.production.preview_urls).toBe(false);
  });

  it("keeps workers.dev on until the custom-domain cutover", () => {
    expect(config.env.production.workers_dev).toBe(true);
  });
});

describe("package scripts", () => {
  it.each(["apps/toiletmap-server/package.json", "apps/toiletmap-client/package.json"])(
    "%s has no script that uploads versions to the production script name",
    (path) => {
      const { scripts } = JSON.parse(readRepoFile(path)) as { scripts: Record<string, string> };
      expect(scripts).not.toHaveProperty("deploy:preview");
      for (const command of Object.values(scripts)) {
        expect(command).not.toMatch(/wrangler versions upload/);
      }
    },
  );
});
