/**
 * Database role hardening (migration 20261124000000_harden_grants_and_functions.sql):
 * - anon / authenticated (Supabase Data API roles, unused) hold no table or
 *   sequence privileges, so no TRUNCATE (which bypasses RLS) or DELETE;
 * - toiletmap_web (the worker's and the legacy app's role) cannot run the
 *   audit schema's SECURITY DEFINER helpers that drop the audit triggers, and
 *   no longer holds TRIGGER / REFERENCES on toilets;
 * - legacy-style writes as toiletmap_web still fire the audit and area
 *   triggers, and the area trigger resolves PostGIS whatever the caller's
 *   search_path is.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClientInstance } from "../../src/prisma";
import { getPrismaClient } from "./setup";
import { getTestDatabaseUrl } from "./utils/env";

const TABLES = [
  "public.toilets",
  "public.areas",
  "public.feedback",
  "public.pending_change",
  "audit.record_version",
] as const;

const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

const AUDIT_FUNCTIONS = [
  "audit.enable_tracking(regclass)",
  "audit.disable_tracking(regclass)",
  "audit.primary_key_columns(oid)",
  "audit.to_record_id(oid, text[], jsonb)",
  "audit.insert_update_delete_trigger()",
  "audit.truncate_trigger()",
] as const;

/** Toilets written by these tests; removed with their audit history afterwards. */
const writtenIds: string[] = [];
const looId = () => {
  const id = randomBytes(12).toString("hex");
  writtenIds.push(id);
  return id;
};

const tablePrivilege = async (role: string, table: string, privilege: string) => {
  const [row] = await getPrismaClient().$queryRaw<{ granted: boolean }[]>`
    SELECT has_table_privilege(${role}, ${table}, ${privilege}) AS granted
  `;
  return row?.granted;
};

const asToiletmapWeb = () => {
  const url = new URL(getTestDatabaseUrl());
  url.username = "toiletmap_web";
  url.password = "toiletmap_web";
  return createPrismaClient(url.toString());
};

afterAll(async () => {
  const prisma = getPrismaClient();
  for (const id of writtenIds) {
    await prisma.$executeRaw`DELETE FROM public.toilets WHERE id = ${id}`;
    await prisma.$executeRaw`
      DELETE FROM audit.record_version
      WHERE table_name = 'toilets' AND ${id} IN (record->>'id', old_record->>'id')
    `;
  }
});

/**
 * A point inside exactly one seeded area, and that area's id. The area trigger
 * takes the first matching area with no ORDER BY, so a point that also lies in
 * an overlapping area (a county around a district) could resolve to either.
 */
const pointInArea = async (offset = 0) => {
  const [row] = await getPrismaClient().$queryRaw<{ id: string; lng: number; lat: number }[]>`
    SELECT a.id,
           ST_X(ST_PointOnSurface(a.geometry::geometry)) AS lng,
           ST_Y(ST_PointOnSurface(a.geometry::geometry)) AS lat
    FROM public.areas a
    WHERE a.geometry IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.areas b
        WHERE b.id <> a.id
          AND b.geometry IS NOT NULL
          AND ST_Within(ST_PointOnSurface(a.geometry::geometry), b.geometry::geometry)
      )
    ORDER BY a.id
    OFFSET ${offset}
    LIMIT 1
  `;
  if (!row) throw new Error("No seeded areas with a geometry; run `pnpm supabase:reset`.");
  return row;
};

describe("Supabase Data API roles", () => {
  for (const role of ["anon", "authenticated"]) {
    it(`${role} holds no privilege on any app table`, async () => {
      for (const table of TABLES) {
        for (const privilege of TABLE_PRIVILEGES) {
          expect({
            table,
            privilege,
            granted: await tablePrivilege(role, table, privilege),
          }).toEqual({ table, privilege, granted: false });
        }
      }
    });

    it(`${role} holds no privilege on the feedback id sequence`, async () => {
      for (const privilege of ["USAGE", "SELECT", "UPDATE"]) {
        const [row] = await getPrismaClient().$queryRaw<{ granted: boolean }[]>`
          SELECT has_sequence_privilege(${role}, 'public.feedback_id_seq', ${privilege}) AS granted
        `;
        expect({ privilege, granted: row?.granted }).toEqual({ privilege, granted: false });
      }
    });
  }

  it("new public tables and sequences are not granted to anon or authenticated by default", async () => {
    const rows = await getPrismaClient().$queryRaw<{ objtype: string; acl: string }[]>`
      SELECT defaclobjtype::text AS objtype, defaclacl::text AS acl
      FROM pg_default_acl
      WHERE defaclrole = 'postgres'::regrole
        AND defaclnamespace = 'public'::regnamespace
        AND defaclobjtype IN ('r', 'S')
    `;
    for (const row of rows) {
      expect(row.acl).not.toMatch(/\b(anon|authenticated)=/);
    }
  });
});

describe("toiletmap_web privileges", () => {
  it("cannot execute the audit schema's definer and trigger functions", async () => {
    for (const fn of AUDIT_FUNCTIONS) {
      for (const role of ["toiletmap_web", "anon", "authenticated", "public"]) {
        const [row] = await getPrismaClient().$queryRaw<{ granted: boolean }[]>`
          SELECT has_function_privilege(${role}, ${fn}, 'EXECUTE') AS granted
        `;
        expect({ fn, role, granted: row?.granted }).toEqual({ fn, role, granted: false });
      }
    }
  });

  it("keeps what the worker and the legacy app use, and nothing extra on toilets", async () => {
    const expected: [string, string, boolean][] = [
      ["public.toilets", "SELECT", true],
      ["public.toilets", "INSERT", true],
      ["public.toilets", "UPDATE", true],
      ["public.toilets", "DELETE", false],
      ["public.toilets", "TRUNCATE", false],
      ["public.toilets", "TRIGGER", false],
      ["public.toilets", "REFERENCES", false],
      ["public.areas", "SELECT", true],
      ["public.areas", "UPDATE", false],
      ["public.feedback", "SELECT", true],
      ["public.feedback", "INSERT", true],
      ["public.feedback", "DELETE", true],
      ["public.feedback", "TRUNCATE", false],
      ["public.pending_change", "SELECT", true],
      ["public.pending_change", "INSERT", true],
      ["public.pending_change", "UPDATE", true],
      ["public.pending_change", "DELETE", false],
      ["audit.record_version", "SELECT", true],
      ["audit.record_version", "DELETE", false],
      ["audit.record_version", "TRUNCATE", false],
    ];
    for (const [table, privilege, granted] of expected) {
      expect({
        table,
        privilege,
        granted: await tablePrivilege("toiletmap_web", table, privilege),
      }).toEqual({
        table,
        privilege,
        granted,
      });
    }
  });
});

describe("as toiletmap_web", () => {
  let web: PrismaClientInstance;

  beforeAll(() => {
    web = asToiletmapWeb();
  });

  afterAll(async () => {
    await web.$disconnect();
  });

  it("is refused audit.disable_tracking and cannot create triggers on toilets", async () => {
    // Inside a transaction that always rolls back, so a regression cannot drop
    // the audit triggers on the shared test database.
    const attempt = (sql: string) =>
      web.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        throw new Error(`unexpectedly allowed: ${sql}`);
      });

    await expect(
      attempt("SELECT audit.disable_tracking('public.toilets'::regclass)"),
    ).rejects.toThrow(/permission denied for function disable_tracking/);
    await expect(
      attempt("SELECT audit.enable_tracking('public.feedback'::regclass)"),
    ).rejects.toThrow(/permission denied for function enable_tracking/);
    await expect(
      attempt(
        "CREATE TRIGGER s1b_probe BEFORE INSERT ON public.toilets FOR EACH ROW " +
          "EXECUTE FUNCTION public.determine_area_loo_is_within_on_upsert()",
      ),
    ).rejects.toThrow(/permission denied for table toilets/);
    await expect(attempt("TRUNCATE public.feedback")).rejects.toThrow(
      /permission denied for table feedback/,
    );

    const [{ count }] = await getPrismaClient().$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM pg_trigger
      WHERE tgrelid = 'public.toilets'::regclass AND tgname IN ('audit_i_u_d', 'audit_t')
    `;
    expect(Number(count)).toBe(2);
  });

  it("legacy-style INSERT and UPDATE on toilets still fire the audit and area triggers", async () => {
    const id = looId();
    const first = await pointInArea(0);
    const second = await pointInArea(1);
    const point = (p: { lng: number; lat: number }) =>
      JSON.stringify({ type: "Point", coordinates: [p.lng, p.lat] });

    // The legacy app's raw INSERT / setLooLocation UPDATE shapes.
    await web.$executeRaw`
      INSERT INTO toilets (id, created_at, updated_at, contributors, name, active, geography)
      VALUES (${id}, now(), now(), ARRAY['db-grants'], 'db-grants loo', true,
              ST_GeomFromGeoJSON(${point(first)}))
    `;
    await web.$executeRaw`
      UPDATE toilets SET
        geography = ST_GeomFromGeoJSON(${point(second)}),
        contributors = array_append(contributors, concat(contributors[array_upper(contributors, 1)], '-location'))
      WHERE id = ${id}
    `;
    // A Prisma-client update, as both apps do.
    await web.toilets.update({ where: { id }, data: { name: "db-grants loo (edited)" } });

    const loo = await getPrismaClient().toilets.findUniqueOrThrow({ where: { id } });
    expect(loo.area_id).toBe(second.id);
    expect(loo.geohash).toBeTruthy();
    expect(loo.contributors).toEqual(["db-grants", "db-grants-location"]);

    const history = await web.$queryRaw<{ op: string; area_id: string | null; name: string }[]>`
      SELECT op::text AS op, record->>'area_id' AS area_id, record->>'name' AS name
      FROM audit.record_version
      WHERE table_name = 'toilets' AND record->>'id' = ${id}
      ORDER BY id
    `;
    expect(history).toEqual([
      { op: "INSERT", area_id: first.id, name: "db-grants loo" },
      { op: "UPDATE", area_id: second.id, name: "db-grants loo" },
      { op: "UPDATE", area_id: second.id, name: "db-grants loo (edited)" },
    ]);
  });

  it("can still lock toilets, review pending changes and delete feedback", async () => {
    // The worker's own toiletmap_web paths: report/restore row locks, admin
    // approve/reject, admin feedback delete. Rolled back, so nothing persists.
    const id = looId();
    const area = await pointInArea(0);
    await getPrismaClient().$executeRaw`
      INSERT INTO public.toilets (id, name, geography)
      VALUES (${id}, 'db-grants lock loo',
              ST_GeomFromGeoJSON(${JSON.stringify({ type: "Point", coordinates: [area.lng, area.lat] })}))
    `;
    const rollback = new Error("rollback");
    await expect(
      web.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM toilets WHERE id = ${id} FOR UPDATE
        `;
        expect(locked).toEqual([{ id }]);
        await tx.$queryRaw`SELECT id FROM toilets WHERE id = ${id} FOR SHARE`;

        const change = await tx.pending_change.create({
          data: { type: "update", loo_id: id, payload: { name: "db-grants" } },
        });
        await tx.pending_change.update({
          where: { id: change.id },
          data: { status: "approved", reviewed_by: "db-grants", reviewed_at: new Date() },
        });
        const { count: rejected } = await tx.pending_change.updateMany({
          where: { id: change.id },
          data: { status: "rejected" },
        });
        expect(rejected).toBe(1);

        const feedback = await tx.feedback.create({
          data: { feedback_text: "db-grants delete probe", route: "/db-grants" },
        });
        const { count: deleted } = await tx.feedback.deleteMany({ where: { id: feedback.id } });
        expect(deleted).toBe(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("can still insert feedback (with RETURNING, as Prisma create does)", async () => {
    const row = await web.feedback.create({
      data: { feedback_text: "db-grants probe", route: "/db-grants" },
    });
    expect(row.id).toBeGreaterThan(0);
    await getPrismaClient().feedback.delete({ where: { id: row.id } });
  });
});

describe("function search_path", () => {
  it("is pinned on the audit and area trigger functions, and never empty for them", async () => {
    const rows = await getPrismaClient().$queryRaw<{ fn: string; config: string[] | null }[]>`
      SELECT p.oid::regprocedure::text AS fn, p.proconfig AS config
      FROM pg_proc p
      WHERE p.oid IN (
        'audit.primary_key_columns(oid)'::regprocedure,
        'audit.to_record_id(oid, text[], jsonb)'::regprocedure,
        'audit.insert_update_delete_trigger()'::regprocedure,
        'public.determine_area_loo_is_within_on_upsert()'::regprocedure
      )
    `;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect({ fn: row.fn, config: row.config }).toEqual({
        fn: row.fn,
        config: ["search_path=pg_catalog, public, extensions, pg_temp"],
      });
    }
  });

  it("lets the area trigger resolve PostGIS for a caller without extensions on its path", async () => {
    const id = looId();
    const area = await pointInArea(0);
    const areaId = await getPrismaClient().$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL search_path = pg_catalog");
      await tx.$executeRaw`
        INSERT INTO public.toilets (id, name, geography)
        VALUES (${id}, 'db-grants no-path loo',
                extensions.st_geogfromtext(${`SRID=4326;POINT(${area.lng} ${area.lat})`}))
      `;
      const [row] = await tx.$queryRaw<{ area_id: string | null }[]>`
        SELECT area_id FROM public.toilets WHERE id = ${id}
      `;
      return row?.area_id;
    });
    expect(areaId).toBe(area.id);
  });
});

describe("migration end-state check", () => {
  // The DO block at the end of the migration fails it when a REVOKE silently did
  // nothing (a non-owner REVOKE only warns) or the pinned path misses an extension.
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20261124000000_harden_grants_and_functions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const verify = migration.slice(migration.indexOf("DO $verify$"));

  const runInRolledBackTx = (before: string | null) =>
    getPrismaClient().$transaction(async (tx) => {
      if (before) await tx.$executeRawUnsafe(before);
      await tx.$executeRawUnsafe(verify);
      throw new Error("verified");
    });

  it("passes on the migrated database", async () => {
    expect(verify).toMatch(/^DO \$verify\$[\s\S]*\$verify\$;\s*$/);
    await expect(runInRolledBackTx(null)).rejects.toThrow(/^verified$/);
  });

  it.each([
    [
      "an audit function still executable by PUBLIC",
      "GRANT EXECUTE ON FUNCTION audit.disable_tracking(regclass) TO PUBLIC",
      /public can still EXECUTE audit\.disable_tracking/,
    ],
    [
      "TRUNCATE left on a table for anon",
      "GRANT TRUNCATE ON public.feedback TO anon",
      /anon still has TRUNCATE on public\.feedback/,
    ],
    [
      "a trigger function without its pinned search_path",
      "ALTER FUNCTION public.determine_area_loo_is_within_on_upsert() RESET search_path",
      /determine_area_loo_is_within_on_upsert\(\) does not have search_path/,
    ],
  ])("fails the migration with %s", async (_label, weaken, message) => {
    await expect(runInRolledBackTx(weaken)).rejects.toThrow(message);
  });
});
