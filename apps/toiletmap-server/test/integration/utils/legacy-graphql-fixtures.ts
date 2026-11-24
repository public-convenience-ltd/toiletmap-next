/**
 * Golden fixtures for the legacy GraphQL compatibility endpoint
 * (test/fixtures/legacy-graphql) and helpers to seed the toilets and audit
 * rows they describe into the local test database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrismaClientInstance } from "../../../src/prisma";

export const LEGACY_FIXTURE_DIR = fileURLToPath(
  new URL("../../fixtures/legacy-graphql/", import.meta.url),
);

export type LegacyFixture = {
  name: string;
  description: string;
  method: "GET" | "POST" | "OPTIONS";
  url: string;
  requestHeaders: Record<string, string>;
  query: string | null;
  variables: Record<string, unknown> | null;
  operationName: string | null;
  status: number;
  headers: Record<string, string>;
  body: any;
};

export type SeedToilet = {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
  active: boolean | null;
  location: { lat: number; lng: number };
  name: string | null;
  openingTimes: unknown;
  accessible: boolean | null;
  men: boolean | null;
  women: boolean | null;
  allGender: boolean | null;
  babyChange: boolean | null;
  children: boolean | null;
  urinalOnly: boolean | null;
  radar: boolean | null;
  automatic: boolean | null;
  noPayment: boolean | null;
  paymentDetails: string | null;
  notes: string | null;
  removalReason: string | null;
  attended: boolean | null;
  geohash: string;
  area: Array<{ name: string | null; type: string | null } | null>;
  appearsIn: string[];
};

export const loadLegacyFixture = (name: string): LegacyFixture =>
  JSON.parse(readFileSync(`${LEGACY_FIXTURE_DIR}${name}.json`, "utf8")) as LegacyFixture;

/** Every `<case>.json` request/response fixture (not the seed file). */
export const listLegacyFixtureNames = (): string[] =>
  readdirSync(LEGACY_FIXTURE_DIR)
    .filter((file) => file.endsWith(".json") && file !== "seed-toilets.json")
    .map((file) => file.replace(/\.json$/, ""))
    .sort();

export const loadSeedToilets = (): SeedToilet[] =>
  (
    JSON.parse(readFileSync(`${LEGACY_FIXTURE_DIR}seed-toilets.json`, "utf8")) as {
      toilets: SeedToilet[];
    }
  ).toilets;

/** Contributor written on seeded rows, so a crashed run's leftovers are recognisable. */
export const SEED_CONTRIBUTOR = "legacy-graphql-fixture";

/** `+00:00` instead of `Z`, the way Postgres writes timestamptz into audit JSON. */
const asPostgresJsonTimestamp = (value: string | null) =>
  value ? value.replace(/Z$/, "+00:00") : null;

/**
 * Inserts the fixture toilets with their real ids, timestamps and fields.
 * The geography is the centre of the stored 20-character geohash cell, which
 * reproduces both the stored `geohash` and the 9-decimal GeoJSON `location`
 * exactly; the area comes from the area trigger, as in production.
 *
 * Refuses to touch an existing row unless it was written by an earlier run
 * of this seeder (contributor {@link SEED_CONTRIBUTOR}).
 */
export const seedLegacyToilets = async (
  prisma: PrismaClientInstance,
  toilets: SeedToilet[],
): Promise<void> => {
  const ids = toilets.map((toilet) => toilet.id);
  const existing = await prisma.toilets.findMany({
    where: { id: { in: ids } },
    select: { id: true, contributors: true },
  });
  const foreign = existing.filter((row) => !row.contributors.includes(SEED_CONTRIBUTOR));
  if (foreign.length > 0) {
    throw new Error(
      `Refusing to seed legacy GraphQL fixtures: ${foreign.map((row) => row.id).join(", ")} already exist in the test database.`,
    );
  }
  await removeLegacySeed(prisma, ids);

  for (const toilet of toilets) {
    await prisma.$executeRaw`
      INSERT INTO toilets (
        id, created_at, updated_at, verified_at, contributors, active, name, opening_times,
        accessible, men, women, all_gender, baby_change, children, urinal_only, radar,
        automatic, no_payment, payment_details, notes, removal_reason, attended, geography
      ) VALUES (
        ${toilet.id}, ${toilet.createdAt}::timestamptz, ${toilet.updatedAt}::timestamptz,
        ${toilet.verifiedAt}::timestamptz, ${[SEED_CONTRIBUTOR]}::text[], ${toilet.active},
        ${toilet.name}, ${toilet.openingTimes === null ? null : JSON.stringify(toilet.openingTimes)}::jsonb,
        ${toilet.accessible}, ${toilet.men}, ${toilet.women}, ${toilet.allGender},
        ${toilet.babyChange}, ${toilet.children}, ${toilet.urinalOnly}, ${toilet.radar},
        ${toilet.automatic}, ${toilet.noPayment}, ${toilet.paymentDetails}, ${toilet.notes},
        ${toilet.removalReason}, ${toilet.attended},
        ST_SetSRID(ST_PointFromGeoHash(${toilet.geohash}), 4326)::geography
      )
    `;
  }

  // The audit trigger recorded each insert; the report fixtures bring their own history.
  await prisma.$executeRaw`
    DELETE FROM audit.record_version WHERE record->>'id' = ANY(${ids}::text[])
  `;
};

type FixtureReport = {
  createdAt: string;
  verifiedAt?: string | null;
  isSystemReport: boolean;
  location?: { lat: number; lng: number } | null;
  [field: string]: unknown;
};

const REPORT_FIELD_TO_COLUMN: Record<string, string> = {
  active: "active",
  name: "name",
  openingTimes: "opening_times",
  accessible: "accessible",
  men: "men",
  women: "women",
  allGender: "all_gender",
  babyChange: "baby_change",
  children: "children",
  urinalOnly: "urinal_only",
  radar: "radar",
  automatic: "automatic",
  noPayment: "no_payment",
  paymentDetails: "payment_details",
  notes: "notes",
  removalReason: "removal_reason",
  attended: "attended",
  geohash: "geohash",
};

/**
 * Inserts one audit row per fixture report, rebuilding the toilets snapshot
 * the legacy resolver read it from. System location rows end their
 * contributors the way legacy `setLooLocation` does: `[x, "x-location"]`. Rows are inserted system rows first, so
 * the endpoint's own ordering (time, then user before system) is exercised.
 */
export const seedLegacyReports = async (
  prisma: PrismaClientInstance,
  looId: string,
  reports: FixtureReport[],
): Promise<void> => {
  const insertionOrder = [
    ...reports.filter((report) => report.isSystemReport),
    ...reports.filter((report) => !report.isSystemReport),
  ];
  for (const report of insertionOrder) {
    const record: Record<string, unknown> = {
      id: looId,
      updated_at: asPostgresJsonTimestamp(report.createdAt),
      verified_at: asPostgresJsonTimestamp(report.verifiedAt ?? null),
      contributors: report.isSystemReport
        ? [SEED_CONTRIBUTOR, `${SEED_CONTRIBUTOR}-location`]
        : [SEED_CONTRIBUTOR],
      location: report.location
        ? { type: "Point", coordinates: [report.location.lng, report.location.lat] }
        : null,
    };
    for (const [fieldName, column] of Object.entries(REPORT_FIELD_TO_COLUMN)) {
      if (fieldName in report) record[column] = report[fieldName];
    }
    await prisma.$executeRaw`
      INSERT INTO audit.record_version (op, record_id, table_oid, table_schema, table_name, record)
      VALUES (
        'INSERT', gen_random_uuid(), 'public.toilets'::regclass::oid, 'public', 'toilets',
        ${JSON.stringify(record)}::jsonb
      )
    `;
  }
};

/** Deletes the seeded toilets and every audit row that mentions them. */
export const removeLegacySeed = async (prisma: PrismaClientInstance, ids: string[]) => {
  await prisma.$executeRaw`DELETE FROM toilets WHERE id = ANY(${ids}::text[])`;
  await prisma.$executeRaw`
    DELETE FROM audit.record_version
    WHERE record->>'id' = ANY(${ids}::text[]) OR old_record->>'id' = ANY(${ids}::text[])
  `;
};
