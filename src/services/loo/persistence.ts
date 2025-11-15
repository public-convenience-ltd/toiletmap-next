import { Prisma } from '../../generated/prisma-client';
import type { LooMutationAttributes } from './types';

// Low-level helpers that keep insert/update logic consistent and auditable.
const emptyTextArray = Prisma.sql`ARRAY[]::text[]`;

const buildContributorsInsertValue = (contributor: string | null | undefined) =>
  contributor ? Prisma.sql`ARRAY[${contributor}]` : emptyTextArray;

const buildContributorsUpdateClause = (
  contributor: string | null | undefined,
) =>
  contributor
    ? Prisma.sql`
        contributors = CASE
          WHEN array_length(contributors, 1) IS NULL THEN ARRAY[${contributor}]
          ELSE array_append(contributors, ${contributor})
        END
      `
    : null;

const geographyExpression = (location: LooMutationAttributes['location']) => {
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
  if (column === 'opening_times' && value !== null) {
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

export const insertLoo = async ({
  tx,
  id,
  data,
  mutation,
  contributor,
  now,
}: InsertArgs) => {
  const columns = [
    Prisma.raw('id'),
    Prisma.raw('created_at'),
    Prisma.raw('updated_at'),
    Prisma.raw('contributors'),
  ];
  const values: Prisma.Sql[] = [
    Prisma.sql`${id}`,
    Prisma.sql`${now}`,
    Prisma.sql`${now}`,
    buildContributorsInsertValue(contributor),
  ];

  for (const [key, value] of Object.entries(data)) {
    columns.push(Prisma.raw(key));
    values.push(toColumnValueSql(key, value));
  }

  const geographySql = geographyExpression(mutation.location);
  if (geographySql) {
    columns.push(Prisma.raw('geography'));
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
      Prisma.sql`${Prisma.raw(key)} = ${toColumnValueSql(key, value)}`,
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
