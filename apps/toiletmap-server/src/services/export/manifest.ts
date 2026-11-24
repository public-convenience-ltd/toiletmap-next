/**
 * Object keys and the manifest of the public dataset in the EXPORTS R2 bucket.
 *
 *   latest/toilets.json, latest/toilets.csv   today's files (overwritten daily)
 *   latest/manifest.json                      describes the latest files; written last
 *   archive/YYYY-MM-DD/toilets.{json,csv}     one copy per UTC day, never deleted
 *   archive/YYYY-MM-DD/manifest.json          that day's manifest
 *   _state/run.json                           run bookkeeping (not served publicly)
 *
 * The client worker serves `latest/*` and `archive/*` at `/dataset/...`.
 */

export const LATEST_PREFIX = "latest/";
export const ARCHIVE_PREFIX = "archive/";
export const MANIFEST_NAME = "manifest.json";
export const LATEST_MANIFEST_KEY = `${LATEST_PREFIX}${MANIFEST_NAME}`;
export const RUN_STATE_KEY = "_state/run.json";

export const archivePrefix = (date: string) => `${ARCHIVE_PREFIX}${date}/`;

export const DATA_FILES = [
  { name: "toilets.json", format: "json", contentType: "application/json; charset=utf-8" },
  { name: "toilets.csv", format: "csv", contentType: "text/csv; charset=utf-8" },
] as const;

export type DataFileName = (typeof DATA_FILES)[number]["name"];

export const MANIFEST_CONTENT_TYPE = "application/json; charset=utf-8";

export type ManifestFile = {
  name: DataFileName;
  format: "json" | "csv";
  /** Key of the latest copy, e.g. `latest/toilets.csv`. */
  key: string;
  /** Key of the same bytes in that day's archive. */
  archiveKey: string;
  contentType: string;
  /** Bytes. */
  size: number;
  /** Lower-case hex SHA-256 of the file. */
  sha256: string;
};

/**
 * The licence and the credit line the licence asks for, as the /dataset page
 * words them. Carried in every manifest so that anyone who fetches the files
 * directly can find them (the JSON and CSV cannot hold a notice without
 * breaking their format).
 */
export const DATASET_LICENCE = {
  licence: "CC-BY-4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Contains data from the Toilet Map © 2025 – CC BY 4.0",
  source: "https://www.toiletmap.org.uk/dataset",
} as const;

export type DatasetManifest = {
  schemaVersion: 1;
  /** ISO 8601 UTC time the data was read. */
  generatedAt: string;
  /** UTC day of `generatedAt` (YYYY-MM-DD), the archive folder. */
  date: string;
  rowCount: number;
  licence: typeof DATASET_LICENCE.licence;
  licenceUrl: typeof DATASET_LICENCE.licenceUrl;
  /** The credit line to show wherever the data is used. */
  attribution: typeof DATASET_LICENCE.attribution;
  /** The page describing the dataset. */
  source: typeof DATASET_LICENCE.source;
  files: ManifestFile[];
  /** Archived days, newest first, including this one. */
  archives: string[];
};

/** Bookkeeping for the run guards. Not published. */
export type RunState = {
  startedAt: string;
  finishedAt?: string;
  trigger: "scheduled" | "admin";
  outcome?: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored manifest, or null when it is missing or not one we wrote. */
export const parseManifest = (text: string | null): DatasetManifest | null => {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (
      isObject(value) &&
      value.schemaVersion === 1 &&
      typeof value.generatedAt === "string" &&
      typeof value.date === "string" &&
      typeof value.rowCount === "number" &&
      Array.isArray(value.files) &&
      Array.isArray(value.archives)
    ) {
      return value as DatasetManifest;
    }
  } catch {
    // Not JSON.
  }
  return null;
};

export const parseRunState = (text: string | null): RunState | null => {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (isObject(value) && typeof value.startedAt === "string") return value as RunState;
  } catch {
    // Not JSON.
  }
  return null;
};

/** The UTC day of a time, as YYYY-MM-DD. */
export const utcDate = (time: Date): string => time.toISOString().slice(0, 10);
