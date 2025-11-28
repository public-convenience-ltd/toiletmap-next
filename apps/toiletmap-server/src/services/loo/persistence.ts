import { randomBytes } from "crypto";
import { Prisma } from "../../prisma";
import type { LooMutationAttributes } from "./types";

import { LOO_ID_LENGTH } from "../../common/constants";

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

const buildContributorsUpdateClause = (
  contributor: string | null | undefined
) =>
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

const toColumnValueSql = (column: string, value: unknown) => {
  if (column === "opening_times" && value !== null) {
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  }
  return Prisma.sql`${value}`;
};

type InsertArgs = {
  tx: Prisma.TransactionClient;
  id: string;
  data: Prisma.toiletsUncheckedCreateInput;
  mutation: LooMutationAttributes;
  contributor: string | null;
  now: Date;
};

/**
 * Inserts a new loo record using raw SQL.
 * Raw SQL is used to handle PostGIS geography types and array operations
 * that are cumbersome or impossible with standard Prisma create.
 */
export const insertLoo = async ({
  tx,
  id,
  data,
  mutation,
  contributor,
  now,
}: InsertArgs) => {
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
    Prisma.sql`${now}`,
    Prisma.sql`${now}`,
    buildContributorsInsertValue(contributor),
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

  await tx.$executeRaw(insertSql);
};

type UpdateArgs = {
  tx: Prisma.TransactionClient;
  id: string;
  data: Prisma.toiletsUncheckedUpdateInput;
  mutation: LooMutationAttributes;
  contributor: string | null;
  now: Date;
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
  contributor,
  now,
}: UpdateArgs) => {
  const assignments: Prisma.Sql[] = [Prisma.sql`updated_at = ${now}`];

  for (const [key, value] of Object.entries(data)) {
    assignments.push(
      Prisma.sql`${Prisma.raw(key)} = ${toColumnValueSql(key, value)}`
    );
  }

  const geographySql = geographyExpression(mutation.location);
  if (geographySql) {
    assignments.push(Prisma.sql`geography = ${geographySql}`);
  }

  const contributorSql = buildContributorsUpdateClause(contributor);
  if (contributorSql) assignments.push(contributorSql);

  const updateSql = Prisma.sql`
    UPDATE toilets
    SET ${Prisma.join(assignments)}
    WHERE id = ${id}
  `;

  const result = await tx.$executeRaw(updateSql);
  return Number(result);
};
