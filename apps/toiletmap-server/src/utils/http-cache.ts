/**
 * HTTP caching policy for the public loo endpoints, kept in one place so the
 * contract the map client relies on is easy to audit.
 *
 * Freshness model: the map client keeps the dump in IndexedDB together with
 * the dump's server cursor and calls `/api/loos/updates?since=<cursor>` for
 * anything newer, so short browser caching of the dump never hides an edit.
 */

/**
 * `/api/loos/dump`: browsers may reuse it for a minute and revalidate in the
 * background for five more; edits made meanwhile arrive via `/updates`.
 */
export const DUMP_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

/**
 * How long a dump stays in the colo-local edge cache. Its key embeds the
 * dataset version, so a write moves readers to a new key and nothing stale is
 * ever served; this only bounds how long superseded versions linger.
 */
export const DUMP_EDGE_TTL_SECONDS = 3600;

/** `/api/loos/updates`: always computed fresh. */
export const UPDATES_CACHE_CONTROL = "no-store";

/**
 * `/api/loos/:id`: revalidate on every use (cheap 304 via ETag). Private
 * because the API applies optional auth to every `/api/*` request, so a shared
 * cache must never reuse one caller's copy for another.
 */
export const LOO_DETAIL_CACHE_CONTROL = "private, max-age=0, must-revalidate";

/** `/api/loos?ids=`: short private caching for API consumers. */
export const LOO_IDS_CACHE_CONTROL = "private, max-age=60";

/** Strips the weak-validator prefix so tags compare by opaque value. */
const opaqueTag = (tag: string): string => tag.trim().replace(/^W\//, "");

/**
 * Weak comparison of an `If-None-Match` header against an ETag, as RFC 9110
 * §13.1.2 requires for `If-None-Match`. Handles lists and `*`.
 */
export const etagMatches = (ifNoneMatch: string | undefined | null, etag: string): boolean => {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const target = opaqueTag(etag);
  return ifNoneMatch.split(",").some((candidate) => opaqueTag(candidate) === target);
};

/**
 * Dataset-version ETag for the dump:
 * `W/"dump-<max updated_at ms>-<row count>-<sum of updated_at µs>"`.
 * The rich variant gets its own prefix since it is a different representation.
 */
export const dumpEtag = (
  version: { maxUpdatedAt: number; count: number; updatedAtSum: string },
  rich = false,
): string =>
  `W/"dump-${rich ? "rich-" : ""}${version.maxUpdatedAt}-${version.count}-${version.updatedAtSum}"`;

/**
 * 32-bit FNV-1a over a string's UTF-16 code units, as 8 hex digits. Not
 * cryptographic: only used to tell representations apart in an ETag.
 */
export const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * Per-record ETag: `W/"loo-<id>-<updatedAt ms>-<hash of the JSON body>"`.
 *
 * `updated_at` alone misses changes to joined data that do not touch the
 * toilets row, such as an area rename, so the tag also hashes the serialized
 * record (the same `JSON.stringify` that becomes the response body). Keeping
 * `updatedAt` in the tag means a write to the record itself always changes
 * it, whatever the hash does.
 */
export const looEtag = (loo: { id: string; updatedAt: string | null }): string => {
  const ms = loo.updatedAt ? Date.parse(loo.updatedAt) : 0;
  return `W/"loo-${loo.id}-${Number.isNaN(ms) ? 0 : ms}-${fnv1a32(JSON.stringify(loo))}"`;
};
