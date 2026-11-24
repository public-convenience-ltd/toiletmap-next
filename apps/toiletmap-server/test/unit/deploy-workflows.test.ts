import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Text-level guards for the deploy workflows (S0, M8, M9, L19). actionlint and zizmor
 * (the "Workflow Lint" CI job) check syntax and general hardening; these pin down the
 * project-specific rules that a later edit could quietly undo.
 */

const workflowsDir = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));
const readWorkflow = (name: string) => readFileSync(`${workflowsDir}${name}`, "utf8");

/** The lines of one job under `jobs:` (2-space job keys), up to the next job. */
const jobBlock = (workflow: string, job: string): string => {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${job}:`);
  if (start === -1) throw new Error(`job ${job} not found`);
  const end = lines.findIndex((line, i) => i > start && /^ {2}[a-z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
};

const MAIN_ONLY = "github.ref == 'refs/heads/main'";

describe("deploy-production.yml", () => {
  const workflow = readWorkflow("deploy-production.yml");

  it.each(["migrate", "deploy-server", "deploy-client"])(
    "%s runs only from main (workflow_dispatch from a branch deploys nothing)",
    (job) => {
      const block = jobBlock(workflow, job);
      expect(block).toContain("environment: production");
      expect(block).toContain(MAIN_ONLY);
    },
  );

  it("smoke is outside the production environment and checks the API through the client", () => {
    const smoke = jobBlock(workflow, "smoke");
    expect(smoke).not.toMatch(/^ {4}environment:/m);
    expect(smoke).not.toMatch(/\$\{\{\s*secrets\./);
    expect(smoke).toContain("/api/loos/proximity?lat=51.5072&lng=-0.1276");
    expect(smoke).toContain(
      "{loosByProximity(from:{lat:51.5072,lng:-0.1276,maxDistance:500}){id name}}",
    );
    expect(smoke).toContain('has("errors") | not');
  });
});

describe("deploy-preview.yml", () => {
  const workflow = readWorkflow("deploy-preview.yml");

  it("never passes the Auth0 credentials as plain-text --var bindings", () => {
    expect(workflow).not.toMatch(/--var\s+"?AUTH0_CLIENT_(ID|SECRET)/);
    const client = jobBlock(workflow, "deploy-client");
    expect(client).toMatch(/\| pnpm exec wrangler secret put AUTH0_CLIENT_SECRET /);
    expect(client).toMatch(/\| pnpm exec wrangler secret put AUTH0_CLIENT_ID /);
  });

  it("keeps secrets out of job-level env", () => {
    for (const job of ["deploy-server", "deploy-client"]) {
      const block = jobBlock(workflow, job);
      expect(block, job).not.toMatch(/^ {4}env:/m);
    }
  });

  it("grants pull-requests: write only to the comment job", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    const writes = workflow.match(/pull-requests: write/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(jobBlock(workflow, "comment-preview-urls")).toContain("pull-requests: write");
  });

  it("serialises runs per branch in the group teardown-preview.yml uses", () => {
    expect(workflow).toMatch(/group: preview-\$\{\{ github\.ref_name \}\}/);
    expect(readWorkflow("teardown-preview.yml")).toMatch(
      /group: preview-\$\{\{ github\.event\.pull_request\.head\.ref \|\| github\.event\.ref \}\}/,
    );
  });
});

describe("teardown-preview.yml", () => {
  const workflow = readWorkflow("teardown-preview.yml");
  const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));

  it("runs on every closed pull request, whatever its base, and on branch delete", () => {
    expect(triggers).toMatch(/pull_request:\n\s+types: \[closed\]/);
    expect(triggers).not.toMatch(/branches:/);
    expect(triggers).toMatch(/^ {2}delete:/m);
  });

  it("passes the branch name through env, not into the script", () => {
    const run = workflow.slice(workflow.indexOf("run: |"));
    expect(run).not.toMatch(/\$\{\{/);
  });

  it("fails on errors other than a worker that is already gone", () => {
    expect(workflow).not.toMatch(/\|\| echo/);
    expect(workflow).toContain('exit "$failed"');
  });
});

describe("all workflows", () => {
  const files = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));

  it.each(files)("%s pins every action to a full commit SHA with a version comment", (file) => {
    const uses = readWorkflow(file).match(/^\s*(?:- )?uses: .+$/gm) ?? [];
    for (const line of uses) {
      expect(line.trim()).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it.each(files)("%s never persists checkout credentials", (file) => {
    const workflow = readWorkflow(file);
    const checkouts = workflow.match(/uses: actions\/checkout@/g) ?? [];
    const disabled = workflow.match(/persist-credentials: false/g) ?? [];
    expect(disabled.length).toBeGreaterThanOrEqual(checkouts.length);
  });
});
