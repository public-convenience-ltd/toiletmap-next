/**
 * The public dataset downloads: `/dataset/latest/*` and `/dataset/archive/*`,
 * served from the EXPORTS R2 bucket that toiletmap-server's daily export
 * writes (see apps/toiletmap-server/src/services/export). The bucket is bound
 * in the production worker only.
 */

/** The part of an R2 object this module reads. */
export type DatasetObject = {
  size: number;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  /** The bytes returned, when the get asked for a range (R2 also sets it without one). */
  range?: { offset?: number; length?: number } | { suffix: number };
};

export type DatasetObjectBody = DatasetObject & { body: ReadableStream; text(): Promise<string> };

/**
 * The part of an R2 bucket binding this module uses. `R2Bucket` satisfies it.
 * `get` with `onlyIf` returns the object without a body when the condition
 * fails (the client's copy is current); with `range` it returns only the
 * bytes the `Range` header asks for.
 */
export interface DatasetBucket {
  get(
    key: string,
    options?: { onlyIf?: Headers; range?: Headers },
  ): Promise<DatasetObjectBody | DatasetObject | null>;
  head(key: string): Promise<DatasetObject | null>;
}

const hasBody = (object: DatasetObject | DatasetObjectBody): object is DatasetObjectBody =>
  "body" in object && object.body != null;

export const DATASET_MANIFEST_KEY = "latest/manifest.json";

/** Only these keys are served; anything else in the bucket stays private. */
const SERVED_KEY =
  /^(latest|archive\/(\d{4}-\d{2}-\d{2}))\/(toilets\.json|toilets\.csv|manifest\.json)$/;

const CACHE_LATEST = "public, max-age=300";
const CACHE_ARCHIVE = "public, max-age=31536000, immutable";
/** Today's archive can still be regenerated from the admin, so it is not immutable yet. */
const CACHE_ARCHIVE_TODAY = "public, max-age=3600";

const FALLBACK_CONTENT_TYPES: Record<string, string> = {
  "toilets.json": "application/json; charset=utf-8",
  "toilets.csv": "text/csv; charset=utf-8",
  "manifest.json": "application/json; charset=utf-8",
};

const textResponse = (status: number, text: string, headers: Record<string, string> = {}) =>
  new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

export const DOWNLOADS_UNAVAILABLE_TEXT =
  "Dataset downloads are only available on the live site, https://www.toiletmap.org.uk/dataset";

/** The entity tags in an If-Match / If-None-Match list (`*` stays `*`). */
const entityTags = (header: string): string[] =>
  header
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const opaqueTag = (tag: string) => tag.replace(/^W\//, "");

/** Whole seconds, as HTTP dates carry them. */
const httpSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

const parseHttpDate = (value: string | null): number | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
};

/**
 * RFC 9110 section 13.2.2, steps 1 and 2: `If-Match` (strong comparison) or,
 * without it, `If-Unmodified-Since`. True when the request must get 412.
 */
const failsWritePrecondition = (headers: Headers, object: DatasetObject): boolean => {
  const ifMatch = headers.get("if-match");
  if (ifMatch !== null) {
    const tags = entityTags(ifMatch);
    return !tags.some((tag) => tag === "*" || (!tag.startsWith("W/") && tag === object.httpEtag));
  }
  const since = parseHttpDate(headers.get("if-unmodified-since"));
  return since !== null && httpSeconds(object.uploaded) > since;
};

/**
 * Steps 3 and 4: `If-None-Match` (weak comparison) or, without it,
 * `If-Modified-Since`. True when the client's copy is current (304).
 */
const isNotModified = (headers: Headers, object: DatasetObject): boolean => {
  const ifNoneMatch = headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    return entityTags(ifNoneMatch).some(
      (tag) => tag === "*" || opaqueTag(tag) === opaqueTag(object.httpEtag),
    );
  }
  const since = parseHttpDate(headers.get("if-modified-since"));
  return since !== null && httpSeconds(object.uploaded) <= since;
};

/**
 * Only the read conditionals, for R2's `onlyIf`. R2 also applies `If-Match`
 * and `If-Unmodified-Since` there and answers a failure with no body, which
 * would be indistinguishable from "not modified"; those two are checked here
 * instead, so they answer 412.
 */
const readConditionals = (headers: Headers): Headers => {
  const conditionals = new Headers();
  for (const name of ["if-none-match", "if-modified-since"]) {
    const value = headers.get(name);
    if (value !== null) conditionals.set(name, value);
  }
  return conditionals;
};

/** `If-Range` still matches the object (strong ETag, or the exact Last-Modified). */
const ifRangeMatches = (value: string, object: DatasetObject): boolean => {
  const tag = value.trim();
  if (tag.startsWith('"') || tag.startsWith("W/")) return tag === object.httpEtag;
  return parseHttpDate(tag) === httpSeconds(object.uploaded);
};

/** The returned range as offset and length, when it is a strict part of the object. */
const partialRange = (object: DatasetObject): { offset: number; length: number } | null => {
  const range = object.range;
  if (!range) return null;
  let offset: number;
  let length: number;
  if ("suffix" in range) {
    length = Math.min(range.suffix, object.size);
    offset = object.size - length;
  } else {
    offset = range.offset ?? 0;
    length = range.length ?? object.size - offset;
  }
  if (offset < 0 || length <= 0 || offset + length > object.size) return null;
  if (offset === 0 && length === object.size) return null;
  return { offset, length };
};

const cancelBody = async (object: DatasetObject | DatasetObjectBody) => {
  if (hasBody(object)) await object.body.cancel().catch(() => undefined);
};

/**
 * Serves one dataset file. `path` is the part after `/dataset/`, e.g.
 * `latest/toilets.csv` or `archive/2026-11-18/toilets.json`.
 *
 * Downloads get `Content-Disposition: attachment` with a dated file name; the
 * manifest is served inline. ETag and Last-Modified come from R2;
 * `If-None-Match` / `If-Modified-Since` answer 304 without reading the body,
 * and a failed `If-Match` / `If-Unmodified-Since` answers 412. A single
 * `Range` (honouring `If-Range`) answers 206, so downloads can resume; any
 * other range gets the whole file. Responses allow any origin, like the
 * legacy files did.
 */
export const serveDatasetFile = async ({
  request,
  bucket,
  path,
  now = new Date(),
}: {
  request: Request;
  bucket: DatasetBucket | undefined;
  path: string;
  now?: Date;
}): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(405, "Method not allowed", { Allow: "GET, HEAD" });
  }

  const match = SERVED_KEY.exec(path);
  if (!match) return textResponse(404, "Not found");

  if (!bucket) return textResponse(503, DOWNLOADS_UNAVAILABLE_TEXT);

  const [, , archiveDate, fileName = ""] = match;
  const wantsRange = request.method === "GET" && request.headers.has("range");
  let object: DatasetObject | DatasetObjectBody | null;
  if (request.method === "HEAD") {
    object = await bucket.head(path);
  } else {
    const onlyIf = readConditionals(request.headers);
    object = wantsRange
      ? await bucket
          .get(path, { onlyIf, range: request.headers })
          // An unsatisfiable or malformed range: serve the whole file instead.
          .catch(() => bucket.get(path, { onlyIf }))
      : await bucket.get(path, { onlyIf });
  }
  if (!object) return textResponse(404, "Not found");

  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType ?? FALLBACK_CONTENT_TYPES[fileName] ?? "",
    ETag: object.httpEtag,
    "Last-Modified": object.uploaded.toUTCString(),
    "Cache-Control": archiveDate
      ? archiveDate === now.toISOString().slice(0, 10)
        ? CACHE_ARCHIVE_TODAY
        : CACHE_ARCHIVE
      : CACHE_LATEST,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  });

  if (fileName !== "manifest.json") {
    const date = archiveDate ?? object.customMetadata?.date;
    const [base, extension] = fileName.split(".");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${date ? `${base}-${date}.${extension}` : fileName}"`,
    );
  }

  if (failsWritePrecondition(request.headers, object)) {
    await cancelBody(object);
    return textResponse(412, "Precondition failed", {
      ETag: object.httpEtag,
      "Last-Modified": object.uploaded.toUTCString(),
    });
  }

  if (request.method === "HEAD") {
    if (isNotModified(request.headers, object)) return new Response(null, { status: 304, headers });
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  // R2 evaluated If-None-Match / If-Modified-Since: no body means "not modified".
  if (!hasBody(object)) return new Response(null, { status: 304, headers });

  if (wantsRange) {
    const ifRange = request.headers.get("if-range");
    const range = partialRange(object);
    if (range && ifRange !== null && !ifRangeMatches(ifRange, object)) {
      // The client's partial copy is of an older file: send the whole new one.
      await cancelBody(object);
      const whole = await bucket.get(path);
      if (!whole || !hasBody(whole)) return textResponse(404, "Not found");
      return new Response(whole.body, { status: 200, headers });
    }
    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
      );
      headers.set("Content-Length", String(range.length));
      return new Response(object.body, { status: 206, headers });
    }
  }

  return new Response(object.body, { status: 200, headers });
};

export type DatasetManifestFile = {
  name: string;
  format: string;
  key: string;
  archiveKey: string;
  size: number;
  sha256: string;
};

export type DatasetManifest = {
  generatedAt: string;
  date: string;
  rowCount: number;
  files: DatasetManifestFile[];
  archives: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isManifestFile = (value: unknown): value is DatasetManifestFile =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.format === "string" &&
  typeof value.key === "string" &&
  typeof value.size === "number" &&
  typeof value.sha256 === "string";

export type DatasetManifestResult =
  /** No EXPORTS binding (dev and preview workers). */
  | { status: "unconfigured" }
  /** Bound, but nothing published yet. */
  | { status: "missing" }
  /** The bucket failed, or the manifest is not one the export wrote. */
  | { status: "error" }
  | { status: "ok"; manifest: DatasetManifest };

/**
 * The latest manifest. A failed read or an unreadable manifest is an error,
 * not "missing", so the page can say downloads are temporarily unavailable
 * rather than that nothing has been published.
 */
export const readDatasetManifest = async (
  bucket: DatasetBucket | undefined,
): Promise<DatasetManifestResult> => {
  if (!bucket) return { status: "unconfigured" };
  try {
    const object = await bucket.get(DATASET_MANIFEST_KEY);
    if (!object) return { status: "missing" };
    if (!hasBody(object)) return { status: "error" };
    const value: unknown = JSON.parse(await object.text());
    if (
      isRecord(value) &&
      typeof value.generatedAt === "string" &&
      typeof value.date === "string" &&
      typeof value.rowCount === "number" &&
      Array.isArray(value.files) &&
      value.files.every(isManifestFile)
    ) {
      return {
        status: "ok",
        manifest: {
          generatedAt: value.generatedAt,
          date: value.date,
          rowCount: value.rowCount,
          files: value.files,
          archives: Array.isArray(value.archives)
            ? value.archives.filter(
                (date): date is string =>
                  typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
              )
            : [],
        },
      };
    }
  } catch {
    // The bucket failed or the JSON is broken.
  }
  return { status: "error" };
};

/** "1.23 MB", as the legacy page showed sizes. */
export const formatMegabytes = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;

/** "18/11/2026, 00:17" in UK time, as the legacy page showed "last updated". */
export const formatUkDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
