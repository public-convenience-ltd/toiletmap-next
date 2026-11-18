import { logger as defaultLogger } from "../../utils/logger";
import {
  type ExportSourceRecord,
  type ExportToilet,
  encodeCsv,
  encodeJson,
  toExportToilet,
} from "./format";
import {
  ARCHIVE_PREFIX,
  archivePrefix,
  DATA_FILES,
  DATASET_LICENCE,
  type DatasetManifest,
  LATEST_MANIFEST_KEY,
  LATEST_PREFIX,
  MANIFEST_CONTENT_TYPE,
  MANIFEST_NAME,
  type ManifestFile,
  parseManifest,
  parseRunState,
  RUN_STATE_KEY,
  type RunState,
  utcDate,
} from "./manifest";

/**
 * The part of an R2 bucket binding the export uses. `R2Bucket` satisfies it;
 * tests pass an in-memory fake.
 */
export interface ExportBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  list(options?: { prefix?: string; delimiter?: string; cursor?: string }): Promise<{
    delimitedPrefixes: string[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export type ExportTrigger = RunState["trigger"];

/**
 * Refuse to publish when the row count falls by more than this fraction
 * against the previous manifest: a sudden drop is far more likely a broken
 * query or a bad deploy than real closures, and consumers would mirror it.
 */
export const MAX_ROW_COUNT_DROP = 0.2;

/**
 * A run that started (or finished) this recently blocks an admin-triggered
 * run, and a run that started this recently and has not finished blocks the
 * scheduled one. A crashed run therefore blocks for at most this long.
 */
export const RUN_GUARD_WINDOW_MS = 5 * 60 * 1000;

export type ExportOutcome =
  | { status: "published"; manifest: DatasetManifest; durationMs: number }
  | {
      status: "skipped";
      reason: "not-configured" | "already-published-today" | "in-progress" | "recent-run";
      message: string;
    }
  | {
      status: "refused";
      reason: "empty" | "row-count-drop";
      message: string;
      rowCount: number;
      previousRowCount: number | null;
    }
  | { status: "failed"; message: string };

type Logger = Pick<typeof defaultLogger, "info" | "warn" | "error">;

export type ExportOptions = {
  /** The EXPORTS binding; undefined where it is not configured (dev, preview). */
  bucket: ExportBucket | undefined;
  /** Every active toilet (`LooService.getAllForExport`). */
  loadRows: () => Promise<ExportSourceRecord[]>;
  trigger: ExportTrigger;
  now?: () => Date;
  logger?: Logger;
};

const readText = async (bucket: ExportBucket, key: string): Promise<string | null> => {
  const object = await bucket.get(key);
  return object ? object.text() : null;
};

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const ARCHIVE_DATE = /^archive\/(\d{4}-\d{2}-\d{2})\/$/;

/** The archived days already in the bucket. */
const listArchiveDates = async (bucket: ExportBucket): Promise<string[]> => {
  const dates: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: ARCHIVE_PREFIX, delimiter: "/", cursor });
    for (const prefix of page.delimitedPrefixes) {
      const match = ARCHIVE_DATE.exec(prefix);
      if (match?.[1]) dates.push(match[1]);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return dates;
};

const isWithin = (iso: string | undefined, now: Date, windowMs: number) => {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && now.getTime() - time < windowMs;
};

/** Why this run should not go ahead, or null to go ahead. */
const checkRunGuards = (
  trigger: ExportTrigger,
  now: Date,
  previous: DatasetManifest | null,
  state: RunState | null,
): Extract<ExportOutcome, { status: "skipped" }> | null => {
  if (trigger === "scheduled") {
    if (previous?.date === utcDate(now)) {
      return {
        status: "skipped",
        reason: "already-published-today",
        message: `Today's dataset (${previous.date}) is already published.`,
      };
    }
    if (state && !state.finishedAt && isWithin(state.startedAt, now, RUN_GUARD_WINDOW_MS)) {
      return {
        status: "skipped",
        reason: "in-progress",
        message: `Another export started at ${state.startedAt} and has not finished.`,
      };
    }
    return null;
  }
  if (
    state &&
    (isWithin(state.startedAt, now, RUN_GUARD_WINDOW_MS) ||
      isWithin(state.finishedAt, now, RUN_GUARD_WINDOW_MS))
  ) {
    return {
      status: "skipped",
      reason: "recent-run",
      message: state.finishedAt
        ? `An export finished at ${state.finishedAt}. Try again in a few minutes.`
        : `An export started at ${state.startedAt} and may still be running. Try again in a few minutes.`,
    };
  }
  return null;
};

const checkRowCount = (
  rowCount: number,
  previous: DatasetManifest | null,
): Extract<ExportOutcome, { status: "refused" }> | null => {
  const previousRowCount = previous?.rowCount ?? null;
  if (rowCount === 0) {
    return {
      status: "refused",
      reason: "empty",
      message: "The query returned no active toilets, so nothing was published.",
      rowCount,
      previousRowCount,
    };
  }
  if (previousRowCount !== null && rowCount < previousRowCount * (1 - MAX_ROW_COUNT_DROP)) {
    return {
      status: "refused",
      reason: "row-count-drop",
      message: `The row count fell from ${previousRowCount} to ${rowCount} (more than ${MAX_ROW_COUNT_DROP * 100}%), so nothing was published.`,
      rowCount,
      previousRowCount,
    };
  }
  return null;
};

/**
 * Maps the loaded rows to published records in the same array, so the raw
 * rows can be collected as they are replaced instead of both arrays (each
 * about 20 MB at 16k rows) being alive at once.
 */
const toExportToiletsInPlace = (rows: ExportSourceRecord[]): ExportToilet[] => {
  const records = rows as unknown as Array<ExportSourceRecord | ExportToilet>;
  for (let index = 0; index < rows.length; index += 1) {
    records[index] = toExportToilet(rows[index] as ExportSourceRecord);
  }
  return records as ExportToilet[];
};

/**
 * Builds the dataset and publishes it to the EXPORTS bucket.
 *
 * Order of writes: the run state, then the archive copies and the archive
 * manifest, then the latest files, and the latest manifest last. Nothing is
 * ever deleted, so a run that fails part-way leaves the previous manifest and
 * every file it describes in place (only the bytes behind `latest/` may be
 * newer than the manifest until a run completes).
 *
 * Memory: a Worker isolate has 128 MB. The rows are loaded once and mapped in
 * place, and each file is encoded straight to bytes a few hundred rows at a
 * time, so at the peak the isolate holds the records plus the two encoded
 * files (about 20 + 19 MB for the ~16k-row dataset in 2026), not the files'
 * full strings as well. See docs/operations/dataset-export.md.
 *
 * Never throws: every outcome, including errors, is returned (and logged).
 */
export const runDatasetExport = async (options: ExportOptions): Promise<ExportOutcome> => {
  const { bucket, loadRows, trigger } = options;
  const now = options.now ?? (() => new Date());
  const log = options.logger ?? defaultLogger;

  if (!bucket) {
    const outcome = {
      status: "skipped",
      reason: "not-configured",
      message: "The EXPORTS bucket binding is not configured in this environment.",
    } as const;
    log.warn("Dataset export skipped", { trigger, reason: outcome.reason });
    return outcome;
  }

  const startedAt = now();
  let stateWritten = false;
  const finish = async (outcome: ExportOutcome): Promise<ExportOutcome> => {
    if (stateWritten) {
      const state: RunState = {
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        trigger,
        outcome: outcome.status === "skipped" ? outcome.reason : outcome.status,
      };
      try {
        await bucket.put(RUN_STATE_KEY, JSON.stringify(state), {
          httpMetadata: { contentType: MANIFEST_CONTENT_TYPE },
        });
      } catch (error) {
        log.warn("Dataset export could not record its run state", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return outcome;
  };

  try {
    const [previous, state] = await Promise.all([
      readText(bucket, LATEST_MANIFEST_KEY).then(parseManifest),
      readText(bucket, RUN_STATE_KEY).then(parseRunState),
    ]);

    const skipped = checkRunGuards(trigger, startedAt, previous, state);
    if (skipped) {
      log.info("Dataset export skipped", { trigger, reason: skipped.reason });
      return skipped;
    }

    const runState: RunState = { startedAt: startedAt.toISOString(), trigger };
    await bucket.put(RUN_STATE_KEY, JSON.stringify(runState), {
      httpMetadata: { contentType: MANIFEST_CONTENT_TYPE },
    });
    stateWritten = true;

    let toilets: ExportToilet[] | null = toExportToiletsInPlace(await loadRows());
    const rowCount = toilets.length;
    const refused = checkRowCount(rowCount, previous);
    if (refused) {
      log.error("Dataset export refused", {
        trigger,
        reason: refused.reason,
        rowCount: refused.rowCount,
        previousRowCount: refused.previousRowCount,
      });
      return await finish(refused);
    }

    const generatedAt = startedAt.toISOString();
    const date = utcDate(startedAt);
    const bodies: Record<(typeof DATA_FILES)[number]["format"], Uint8Array<ArrayBuffer>> = {
      json: encodeJson(toilets),
      csv: encodeCsv(toilets),
    };
    // Only the bytes are needed from here on.
    toilets = null;

    const files: ManifestFile[] = await Promise.all(
      DATA_FILES.map(async (file) => ({
        name: file.name,
        format: file.format,
        key: `${LATEST_PREFIX}${file.name}`,
        archiveKey: `${archivePrefix(date)}${file.name}`,
        contentType: file.contentType,
        size: bodies[file.format].byteLength,
        sha256: await sha256Hex(bodies[file.format]),
      })),
    );

    const archives = [...new Set([date, ...(await listArchiveDates(bucket))])].sort().reverse();
    const manifest: DatasetManifest = {
      schemaVersion: 1,
      generatedAt,
      date,
      rowCount,
      ...DATASET_LICENCE,
      files,
      archives,
    };
    const manifestBody = JSON.stringify(manifest, null, 2);

    const putFile = (key: string, file: ManifestFile) =>
      bucket.put(key, bodies[file.format], {
        httpMetadata: { contentType: file.contentType },
        customMetadata: {
          generatedAt,
          date,
          rowCount: String(rowCount),
          sha256: file.sha256,
        },
      });
    const putManifest = (key: string) =>
      bucket.put(key, manifestBody, {
        httpMetadata: { contentType: MANIFEST_CONTENT_TYPE },
        customMetadata: { generatedAt, date },
      });

    // Data first, manifests after the files they describe, latest manifest last.
    await Promise.all(files.map((file) => putFile(file.archiveKey, file)));
    await putManifest(`${archivePrefix(date)}${MANIFEST_NAME}`);
    await Promise.all(files.map((file) => putFile(file.key, file)));
    await putManifest(LATEST_MANIFEST_KEY);

    const durationMs = now().getTime() - startedAt.getTime();
    log.info("Dataset export published", {
      trigger,
      date,
      rowCount: manifest.rowCount,
      sizes: Object.fromEntries(files.map((file) => [file.name, file.size])),
      duration: durationMs,
    });
    return await finish({ status: "published", manifest, durationMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("Dataset export failed", { trigger, errorMessage: message });
    return finish({ status: "failed", message });
  }
};
