/**
 * The public dataset's file formats, ported from the legacy export
 * (`toiletmap/src/pages/api/cron/daily_export.page.ts`) so existing consumers
 * keep working: the same columns in the same order, the same snake_case
 * names, and the same value encoding.
 *
 * JSON: one array of objects, `JSON.stringify` output with no whitespace.
 * CSV: an unquoted header row, then one row per toilet with every cell quoted
 * (`"` doubled inside), rows separated by `\n` with no trailing newline. Dates
 * are ISO 8601 UTC, null is an empty cell, booleans are `true`/`false`, and the
 * JSON columns (`opening_times`, `location`, `areas`) are JSON text. The CSV
 * adds `longitude` and `latitude` (from `location`) as the last two columns.
 *
 * One deliberate difference from legacy: a CSV text cell that a spreadsheet
 * would run as a formula gets a leading `'` (see {@link neutraliseFormula}).
 * The JSON is unchanged.
 */

/** One toilet in the export, keys in published order. */
export type ExportToilet = {
  id: string;
  created_at: string | null;
  accessible: boolean | null;
  active: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  baby_change: boolean | null;
  men: boolean | null;
  name: string | null;
  no_payment: boolean | null;
  notes: string | null;
  payment_details: string | null;
  radar: boolean | null;
  women: boolean | null;
  updated_at: string | null;
  urinal_only: boolean | null;
  all_gender: boolean | null;
  children: boolean | null;
  geohash: string | null;
  verified_at: string | null;
  area_id: string | null;
  opening_times: unknown;
  /** A GeoJSON point, as PostGIS `ST_AsGeoJSON` writes it. */
  location: unknown;
  areas: { name: string | null; id: string } | null;
};

/** The JSON file's keys, in order. The CSV has these plus `longitude`, `latitude`. */
export const EXPORT_JSON_COLUMNS = [
  "id",
  "created_at",
  "accessible",
  "active",
  "attended",
  "automatic",
  "baby_change",
  "men",
  "name",
  "no_payment",
  "notes",
  "payment_details",
  "radar",
  "women",
  "updated_at",
  "urinal_only",
  "all_gender",
  "children",
  "geohash",
  "verified_at",
  "area_id",
  "opening_times",
  "location",
  "areas",
] as const satisfies ReadonlyArray<keyof ExportToilet>;

export const EXPORT_CSV_COLUMNS = [...EXPORT_JSON_COLUMNS, "longitude", "latitude"] as const;

/** The database row the export is built from (see `LooService.getAllForExport`). */
export type ExportSourceRecord = {
  id: string;
  created_at: Date | null;
  accessible: boolean | null;
  active: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  baby_change: boolean | null;
  men: boolean | null;
  name: string | null;
  no_payment: boolean | null;
  notes: string | null;
  payment_details: string | null;
  radar: boolean | null;
  women: boolean | null;
  updated_at: Date | null;
  urinal_only: boolean | null;
  all_gender: boolean | null;
  children: boolean | null;
  geohash: string | null;
  verified_at: Date | null;
  area_id: string | null;
  opening_times: unknown;
  location: unknown;
  areas: { name: string | null; id: string } | null;
};

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Builds the published record, field by field. Only the fields listed here
 * can reach the files, whatever else the source object carries.
 */
export const toExportToilet = (row: ExportSourceRecord): ExportToilet => ({
  id: row.id,
  created_at: iso(row.created_at),
  accessible: row.accessible,
  active: row.active,
  attended: row.attended,
  automatic: row.automatic,
  baby_change: row.baby_change,
  men: row.men,
  name: row.name,
  no_payment: row.no_payment,
  notes: row.notes,
  payment_details: row.payment_details,
  radar: row.radar,
  women: row.women,
  updated_at: iso(row.updated_at),
  urinal_only: row.urinal_only,
  all_gender: row.all_gender,
  children: row.children,
  geohash: row.geohash,
  verified_at: iso(row.verified_at),
  area_id: row.area_id,
  opening_times: row.opening_times ?? null,
  location: row.location ?? null,
  areas: row.areas ? { name: row.areas.name, id: row.areas.id } : null,
});

/** Longitude and latitude from a GeoJSON point, as strings ("" when missing). Legacy `extractLngLat`. */
export const extractLngLat = (location: unknown): { longitude: string; latitude: string } => {
  try {
    const obj = typeof location === "string" ? JSON.parse(location) : location;
    const coords = (obj as { coordinates?: unknown } | null)?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const [lng, lat] = coords;
      return {
        longitude: Number.isFinite(lng) ? String(lng) : "",
        latitude: Number.isFinite(lat) ? String(lat) : "",
      };
    }
  } catch {
    // Not JSON: no coordinates.
  }
  return { longitude: "", latitude: "" };
};

/** Legacy `replacer`: nulls nested inside JSON cells become "". */
const nullToEmpty = (_key: string, value: unknown) => (value === null ? "" : value);

/**
 * Characters that make Excel, LibreOffice or Google Sheets treat a cell as a
 * formula even inside quotes (OWASP "CSV injection"), including the
 * full-width forms some of them also accept.
 */
const FORMULA_START = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;

/**
 * Prefixes a `'` to text that a spreadsheet would run as a formula, so a
 * contributor-written name such as `=HYPERLINK(...)` opens as plain text.
 * Only text cells pass through here; `longitude`/`latitude` (which may start
 * with `-`) are written as they are.
 */
export const neutraliseFormula = (text: string): string =>
  FORMULA_START.test(text) ? `'${text}` : text;

/** One cell's text before quoting. Legacy `serialise`, plus formula neutralising. */
const serialiseCell = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return neutraliseFormula(value);
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, nullToEmpty);
};

/** Quotes a CSV cell (RFC 4180: wrap in quotes, double any quote inside). */
const quoteCsvCell = (text: string): string => `"${text.replace(/"/g, '""')}"`;

/** Rows per chunk when building the files: bounds the size of each temporary string. */
const CHUNK_ROWS = 500;

/** The JSON file in pieces; joined, they are exactly `JSON.stringify(toilets)`. */
function* jsonPieces(toilets: readonly ExportToilet[]): Generator<string> {
  yield "[";
  for (let start = 0; start < toilets.length; start += CHUNK_ROWS) {
    const rows = toilets.slice(start, start + CHUNK_ROWS).map((toilet) => JSON.stringify(toilet));
    yield (start === 0 ? "" : ",") + rows.join(",");
  }
  yield "]";
}

const csvLine = (toilet: ExportToilet): string => {
  const { longitude, latitude } = extractLngLat(toilet.location);
  const cells: string[] = EXPORT_JSON_COLUMNS.map((column) =>
    quoteCsvCell(serialiseCell(toilet[column])),
  );
  cells.push(quoteCsvCell(longitude), quoteCsvCell(latitude));
  return cells.join(",");
};

/**
 * The CSV file in pieces. Empty input gives no pieces (an empty file), as
 * legacy did (the job refuses to publish an empty dataset anyway).
 */
function* csvPieces(toilets: readonly ExportToilet[]): Generator<string> {
  if (toilets.length === 0) return;
  yield EXPORT_CSV_COLUMNS.join(",");
  for (let start = 0; start < toilets.length; start += CHUNK_ROWS) {
    yield `\n${toilets
      .slice(start, start + CHUNK_ROWS)
      .map(csvLine)
      .join("\n")}`;
  }
}

/**
 * UTF-8 bytes of the pieces, encoded a chunk at a time so the whole file never
 * exists as one string (V8 may store it as two bytes per character).
 */
const encodePieces = (pieces: Iterable<string>): Uint8Array<ArrayBuffer> => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (const piece of pieces) {
    const chunk = encoder.encode(piece);
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const buildJson = (toilets: readonly ExportToilet[]): string =>
  [...jsonPieces(toilets)].join("");

/** The CSV file as text. Empty input gives an empty string. */
export const buildCsv = (toilets: readonly ExportToilet[]): string =>
  [...csvPieces(toilets)].join("");

/** The JSON file's UTF-8 bytes (the same bytes as encoding {@link buildJson}). */
export const encodeJson = (toilets: readonly ExportToilet[]): Uint8Array<ArrayBuffer> =>
  encodePieces(jsonPieces(toilets));

/** The CSV file's UTF-8 bytes (the same bytes as encoding {@link buildCsv}). */
export const encodeCsv = (toilets: readonly ExportToilet[]): Uint8Array<ArrayBuffer> =>
  encodePieces(csvPieces(toilets));
