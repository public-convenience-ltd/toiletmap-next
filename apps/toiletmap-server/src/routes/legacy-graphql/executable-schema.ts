import { assertScalarType, buildSchema, type GraphQLSchema } from "graphql";
import {
  parseDateTimeLiteral,
  parseDateTimeValue,
  parseOpeningTimesLiteral,
  serializeDateTime,
  validateOpeningTimes,
} from "./scalars";
import { LEGACY_GRAPHQL_SDL } from "./schema";

/**
 * Builds the frozen legacy schema with the legacy scalar behaviour. Root
 * fields resolve from `rootValue` (see `resolvers.ts`); every other field is
 * a plain property of the mapped objects.
 */
const buildLegacySchema = (): GraphQLSchema => {
  const schema = buildSchema(LEGACY_GRAPHQL_SDL);

  Object.assign(assertScalarType(schema.getType("DateTime")), {
    serialize: serializeDateTime,
    parseValue: parseDateTimeValue,
    parseLiteral: parseDateTimeLiteral,
  });
  Object.assign(assertScalarType(schema.getType("OpeningTimes")), {
    serialize: validateOpeningTimes,
    parseValue: validateOpeningTimes,
    parseLiteral: parseOpeningTimesLiteral,
  });

  return schema;
};

let cached: GraphQLSchema | undefined;

/** The schema, built once per isolate. */
export const getLegacySchema = (): GraphQLSchema => {
  cached ??= buildLegacySchema();
  return cached;
};
