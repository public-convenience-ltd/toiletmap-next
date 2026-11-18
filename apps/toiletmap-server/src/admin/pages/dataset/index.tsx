import type { Context } from "hono";
import {
  type DatasetManifest,
  type ExportOutcome,
  LATEST_MANIFEST_KEY,
  parseManifest,
  runDatasetExport,
} from "../../../services/export";
import type { AppVariables, Env } from "../../../types";
import { getEnvironmentName } from "../../../utils/environment";
import { createLogger } from "../../../utils/logger";

type AdminContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Where the panel lives (the dataset explorer), and where the button returns to. */
const PANEL_PATH = "/admin/loos";

/**
 * Fixed notice codes. The redirect carries only a code, never free text, so
 * nothing is reflected into the page; the panel itself shows the numbers.
 */
const NOTICES = {
  published: { tone: "success", text: "Dataset regenerated and published." },
  "recent-run": {
    tone: "warning",
    text: "An export ran or started in the last few minutes, so this one was not started. Try again shortly.",
  },
  "in-progress": {
    tone: "warning",
    text: "An export is already running. Try again shortly.",
  },
  "already-published-today": {
    tone: "warning",
    text: "Today's dataset is already published.",
  },
  "not-configured": {
    tone: "warning",
    text: "Export storage (the EXPORTS bucket) is not configured in this environment, so nothing was published.",
  },
  empty: {
    tone: "warning",
    text: "Refused: the query returned no active toilets. The previous files are still published. Check the logs.",
  },
  "row-count-drop": {
    tone: "warning",
    text: "Refused: the row count dropped by more than 20% since the last export. The previous files are still published. Check the logs.",
  },
  failed: {
    tone: "warning",
    text: "The export failed. The previous files are still published. Check the logs.",
  },
} as const;

type NoticeCode = keyof typeof NOTICES;

const noticeFor = (outcome: ExportOutcome): NoticeCode =>
  outcome.status === "published" || outcome.status === "failed" ? outcome.status : outcome.reason;

export type DatasetExportStatus =
  | { configured: false }
  | { configured: true; manifest: DatasetManifest | null; error?: true };

/** What the panel shows: whether the bucket is bound, and the latest manifest. */
export const loadDatasetExportStatus = async (env: Env): Promise<DatasetExportStatus> => {
  if (!env.EXPORTS) return { configured: false };
  try {
    const object = await env.EXPORTS.get(LATEST_MANIFEST_KEY);
    return { configured: true, manifest: parseManifest(object ? await object.text() : null) };
  } catch {
    return { configured: true, manifest: null, error: true };
  }
};

const formatGeneratedAt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(iso));

const formatMegabytes = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;

/** The "Public dataset" panel on the dataset explorer. */
export const DatasetExportPanel = ({
  status,
  notice,
}: {
  status: DatasetExportStatus;
  notice: string | undefined;
}) => {
  const banner = notice && Object.hasOwn(NOTICES, notice) ? NOTICES[notice as NoticeCode] : null;
  const manifest = status.configured ? status.manifest : null;
  return (
    <section class="dataset-export" aria-labelledby="dataset-export-heading">
      <div class="dataset-export__summary">
        <h2 id="dataset-export-heading" class="dataset-export__title">
          Public dataset
        </h2>
        <p class="dataset-export__meta" data-dataset-export-status>
          {!status.configured
            ? "Export storage is not configured in this environment (production only)."
            : manifest
              ? `Last published ${formatGeneratedAt(manifest.generatedAt)}: ${manifest.rowCount.toLocaleString("en-GB")} toilets, ${manifest.files
                  .map((file) => `${file.format.toUpperCase()} ${formatMegabytes(file.size)}`)
                  .join(", ")}.`
              : status.error
                ? "Could not read the latest manifest."
                : "Not published yet. The daily export runs at 00:17 UTC."}
        </p>
      </div>
      <form method="post" action="/admin/dataset/regenerate" class="dataset-export__form">
        <button type="submit" class="button button--secondary" disabled={!status.configured}>
          Regenerate dataset now
        </button>
      </form>
      {banner && (
        <p
          class={`dataset-export__notice dataset-export__notice--${banner.tone}`}
          role="status"
          data-dataset-export-notice={notice}
        >
          {banner.text}
        </p>
      )}
    </section>
  );
};

/** `waitUntil` where the runtime provides an execution context (not in `app.request` tests). */
const keepAlive = (c: AdminContext, promise: Promise<unknown>) => {
  let ctx: AdminContext["executionCtx"] | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    // Hono throws when there is no execution context.
    return;
  }
  ctx.waitUntil(promise);
};

/**
 * POST /admin/dataset/regenerate: runs the same export job as the cron, now.
 * Admin-only (the admin router's requireAdminRole). The job's own guard
 * refuses a run within a few minutes of another starting or finishing.
 */
export const datasetRegenerate = async (c: AdminContext) => {
  // Cookie-authenticated POST: refuse other sites' forms (SameSite=Lax alone
  // does not cover sibling subdomains).
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.text("Cross-origin request refused", 403);
  }
  if (c.req.header("sec-fetch-site") === "cross-site") {
    return c.text("Cross-origin request refused", 403);
  }

  const logger = createLogger(getEnvironmentName(c.env));
  const sub = c.get("user")?.sub;
  logger.info("Dataset export requested from admin", { userId: sub });

  const looService = c.get("looService");
  const run = runDatasetExport({
    bucket: c.env.EXPORTS,
    loadRows: () => looService.getAllForExport(),
    trigger: "admin",
    logger,
  });
  // Also handed to waitUntil: if the admin closes the tab or the connection
  // drops, the run still finishes instead of being cancelled between writes
  // (which would leave latest/ files newer than latest/manifest.json).
  keepAlive(c, run);
  const outcome = await run;

  logger.info("Admin dataset export finished", {
    userId: sub,
    outcome: outcome.status,
    ...(outcome.status === "published" ? { rowCount: outcome.manifest.rowCount } : {}),
    ...(outcome.status === "skipped" || outcome.status === "refused"
      ? { reason: outcome.reason }
      : {}),
  });

  return c.redirect(`${PANEL_PATH}?export=${noticeFor(outcome)}`, 303);
};

export const datasetExportStyles = `
  .dataset-export { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs) var(--space-s); margin-bottom: var(--space-m); padding: var(--space-xs) var(--space-s); border: 1px solid #e4e4e7; border-radius: 16px; background: var(--color-white); }
  .dataset-export__summary { flex: 1 1 20rem; min-width: 0; }
  .dataset-export__title { margin: 0; font-size: var(--text-0); }
  .dataset-export__meta { margin: 0; color: var(--color-neutral-grey); font-size: var(--text--1); }
  .dataset-export__form { margin: 0; }
  .dataset-export__notice { flex-basis: 100%; margin: 0; padding: var(--space-3xs) var(--space-xs); border-radius: 8px; font-weight: 600; }
  .dataset-export__notice--success { background: #e2fbf2; color: var(--color-primary-navy); }
  .dataset-export__notice--warning { background: #fde5eb; color: var(--color-accent-pink); }
`;
