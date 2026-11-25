import { randomBytes } from "crypto";
import { LOO_ID_LENGTH } from "../../common/constants";
import { Prisma } from "../../prisma";
import type { LooMutationAttributes } from "./types";

export { LOO_ID_LENGTH };

/**
 * Generates a unique identifier for a new loo.
 * Creates a cryptographically random 12-byte value and encodes it as a 24-character hex string.
 *
 * @returns A 24-character hexadecimal string suitable for use as a loo ID
 *
 * @example
 * ```typescript
 * const id = generateLooId();
 * // Returns something like: "a1b2c3d4e5f6789012345678"
 * ```
 */
export const generateLooId = (): string => randomBytes(12).toString("hex");

// Low-level helpers that keep insert/update logic consistent and auditable.
const emptyTextArray = Prisma.sql`ARRAY[]::text[]`;

const buildContributorsInsertValue = (contributor: string | null | undefined) =>
  contributor ? Prisma.sql`ARRAY[${contributor}]` : emptyTextArray;

const buildContributorsUpdateClause = (contributor: string | null | undefined) =>
  contributor
    ? Prisma.sql`
        contributors = CASE
          WHEN array_length(contributors, 1) IS NULL THEN ARRAY[${contributor}]
          ELSE array_append(contributors, ${contributor})
        END
      `
    : null;

/**
 * Converts a location object to a PostGIS geography expression.
 * We use raw SQL here because Prisma doesn't fully support PostGIS types natively
 * in a way that allows easy casting to geography(Point, 4326).
 */
const geographyExpression = (location: LooMutationAttributes["location"]) => {
  if (location === undefined) return null;
  if (location === null) return Prisma.sql`NULL`;
  return Prisma.sql`
    ST_SetSRID(
      ST_MakePoint(${location.lng}, ${location.lat}),
      4326
    )::geography
  `;
};

/**
 * Timestamps written by mutations come from the database clock, the same clock
 * the sync cursor of `/api/loos/dump` and `/api/loos/updates` is read from
 * (`now() - 120s`, see `LooService.getSyncCursor`). Using one clock removes
 * Worker/database skew from the freshness guarantee.
 *
 * `now()` is the transaction's start time, so a row becomes visible to other
 * readers slightly after the instant its `updated_at` names. The 120 second
 * overlap on the cursor covers that gap (a mutation transaction is a handful of
 * statements and Hyperdrive/Postgres time out well before two minutes), so a
 * change committed while a dump is being read is always re-delivered by the
 * next `/updates` call rather than lost.
 */
const dbNow = Prisma.sql`now()`;

const toColumnValueSql = (column: string, value: unknown) => {
  if (column === "opening_times" && value !== null) {
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  }
  return Prisma.sql`${value}`;
};

/**
 * Who a write is attributed to: the contributor name appended to
 * `contributors` (public, shown as a count) and the Auth0 `sub` stored
 * privately in `toilets.updated_by_sub`. Both are null for an anonymous
 * change (for an approved queued change: its submitter, not the moderator).
 */
export type WriteActor = {
  contributor: string | null;
  sub: string | null;
};

/**
 * Names the Auth0 account behind the next write in this transaction.
 *
 * The trigger `toilets_set_updated_by_sub` (migration
 * 20261125000000_write_attribution.sql) copies the transaction-local setting
 * `toiletmap.actor_sub` into `toilets.updated_by_sub` on every INSERT and
 * UPDATE, so a write that does not set it, such as any legacy-app write,
 * stores NULL rather than inheriting the previous writer's sub. `''` clears
 * it (an anonymous change). Must run inside the same transaction as the write.
 */
export const setWriteActorSub = async (tx: Prisma.TransactionClient, sub: string | null) => {
  // biome-ignore lint/suspicious/noExplicitAny: Prisma 7.8.0 / TS 6.0.3 type gap (see insertLoo)
  await (tx as any).$queryRaw(
    Prisma.sql`SELECT set_config('toiletmap.actor_sub', ${sub ?? ""}, true)`,
  );
};

type InsertArgs = {
  tx: Prisma.TransactionClient;
  id: string;
  data: Prisma.toiletsUncheckedCreateInput;
  mutation: LooMutationAttributes;
  actor: WriteActor;
};

/**
 * Inserts a new loo record using raw SQL.
 * Raw SQL is used to handle PostGIS geography types and array operations
 * that are cumbersome or impossible with standard Prisma create.
 */
export const insertLoo = async ({ tx, id, data, mutation, actor }: InsertArgs) => {
  const keys = Object.keys(data);
  const columns = [
    Prisma.raw("id"),
    Prisma.raw("created_at"),
    Prisma.raw("updated_at"),
    Prisma.raw("contributors"),
    ...keys.map((k) => Prisma.raw(k)),
  ];

  const values = [
    Prisma.sql`${id}`,
    dbNow,
    dbNow,
    buildContributorsInsertValue(actor.contributor),
    ...keys.map((k) => toColumnValueSql(k, data[k as keyof typeof data])),
  ];

  const geographySql = geographyExpression(mutation.location);
  if (geographySql) {
    columns.push(Prisma.raw("geography"));
    values.push(geographySql);
  }

  const insertSql = Prisma.sql`
    INSERT INTO toilets (${Prisma.join(columns)})
    VALUES (${Prisma.join(values)})
  `;

  await setWriteActorSub(tx, actor.sub);
  // Prisma.TransactionClient omits $executeRaw in TS 6.0.3 due to over-eager
  // ITXClientDenyList resolution; the method is present at runtime.
  // biome-ignore lint/suspicious/noExplicitAny: Prisma 7.8.0 / TS 6.0.3 type gap
  await (tx as any).$executeRaw(insertSql);
};

type UpdateArgs = {
  tx: Prisma.TransactionClient;
  id: string;
  data: Prisma.toiletsUncheckedUpdateInput;
  mutation: LooMutationAttributes;
  actor: WriteActor;
  /**
   * Optimistic-concurrency guard. When provided, the row is only updated if its
   * `updated_at` still equals this value (to millisecond precision); `null`
   * matches a row whose `updated_at` is NULL.
   */
  expectedUpdatedAt?: Date | null;
};

/**
 * Updates an existing loo record using raw SQL.
 * Handles appending contributors and updating geography fields.
 * Returns the number of affected rows (0 or 1).
 */
export const updateLoo = async ({
  tx,
  id,
  data,
  mutation,
  actor,
  expectedUpdatedAt,
}: UpdateArgs) => {
  const assignments: Prisma.Sql[] = [Prisma.sql`updated_at = ${dbNow}`];

  for (const [key, value] of Object.entries(data)) {
    assignments.push(Prisma.sql`${Prisma.raw(key)} = ${toColumnValueSql(key, value)}`);
  }

  const geographySql = geographyExpression(mutation.location);
  if (geographySql) {
    assignments.push(Prisma.sql`geography = ${geographySql}`);
  }

  const contributorSql = buildContributorsUpdateClause(actor.contributor);
  if (contributorSql) assignments.push(contributorSql);

  // JS Dates carry millisecond precision while timestamptz stores microseconds,
  // so match within one millisecond rather than exactly.
  const versionGuard =
    expectedUpdatedAt === undefined
      ? Prisma.empty
      : expectedUpdatedAt === null
        ? Prisma.sql`AND updated_at IS NULL`
        : Prisma.sql`AND updated_at > ${expectedUpdatedAt}::timestamptz - interval '1 millisecond'
            AND updated_at < ${expectedUpdatedAt}::timestamptz + interval '1 millisecond'`;

  const updateSql = Prisma.sql`
    UPDATE toilets
    SET ${Prisma.join(assignments)}
    WHERE id = ${id}
    ${versionGuard}
  `;

  await setWriteActorSub(tx, actor.sub);
  // biome-ignore lint/suspicious/noExplicitAny: Prisma 7.8.0 / TS 6.0.3 type gap
  const result = await (tx as any).$executeRaw(updateSql);
  return Number(result);
};
