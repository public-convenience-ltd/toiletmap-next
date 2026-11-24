/**
 * Request limits for the legacy GraphQL endpoint. GraphQL lets one request
 * fan out into many expensive reads, so the shape of every document is
 * checked before anything runs.
 */
import {
  type ASTVisitor,
  type DocumentNode,
  GraphQLError,
  type GraphQLSchema,
  Kind,
  type SelectionSetNode,
  specifiedRules,
  type ValidationContext,
  validate,
} from "graphql";
import { MAX_PROXIMITY_RADIUS } from "../../common/constants";

export const LEGACY_GRAPHQL_LIMITS = {
  /** Characters in the query document (GET `query` or POST `query`). */
  maxQueryLength: 10_000,
  /** Bytes in a POST body (query plus variables). */
  maxBodyBytes: 32 * 1024,
  /**
   * Lexer tokens; parsing stops beyond this (bounds parse and validation
   * time). The standard introspection query is about 160 tokens.
   */
  maxTokens: 1_000,
  /** Nesting depth of data fields, root fields at 1. Introspection is bounded by graphql-js. */
  maxDepth: 8,
  /**
   * Fields selected, counted after expanding fragments, introspection fields
   * included. This also bounds graphql-js's own validation, which is
   * quadratic in the number of sibling fields.
   */
  maxFields: 250,
  /** Fields requested under an alias different from their name. */
  maxAliases: 15,
  /** Sum of root field costs ({@link ROOT_FIELD_COST}). */
  maxCost: 20,
  /** Same cap as the legacy API: `loos` pages hold at most 100 loos. */
  maxPageSize: 100,
  /** Ids per `looNamesByIds` call. */
  maxIds: 100,
  /** Metres; same cap as the REST `/api/loos/proximity`. */
  maxDistance: MAX_PROXIMITY_RADIUS,
  /**
   * `loosByGeohash` / `fullLoosByGeohash` prefixes shorter than this (a
   * 3-character cell is about 156 km square) are "broad" reads...
   */
  minPreciseGeohashLength: 4,
  /** ...and a request may contain at most this many of them. */
  maxBroadGeohashFields: 1,
} as const;

/**
 * Relative cost of each root field, roughly the database work it causes.
 * Unknown names cost 1 (validation rejects them anyway).
 */
const ROOT_FIELD_COST: Record<string, number> = {
  __typename: 0,
  __type: 1,
  __schema: 5,
  loo: 1,
  looNamesByIds: 2,
  reportsForLoo: 2,
  areas: 2,
  loosByProximity: 3,
  loosByGeohash: 3,
  loos: 5,
  fullLoosByGeohash: 5,
  statistics: 10,
};

/** Upper bound on selections visited while expanding fragments (stops fragment bombs). */
const MAX_VISITED_SELECTIONS = 5_000;

export const READ_ONLY_MESSAGE = "This API is read-only; use the REST API.";

/** Rejects any mutation or subscription operation during validation. */
export const ReadOnlyOperationsRule = (context: ValidationContext): ASTVisitor => ({
  OperationDefinition(node) {
    if (node.operation !== "query") {
      context.reportError(new GraphQLError(READ_ONLY_MESSAGE, { nodes: node }));
    }
  },
});

type Stats = { fields: number; aliases: number; depth: number; cost: number; visited: number };

class LimitExceeded extends Error {}

/**
 * Enforces {@link LEGACY_GRAPHQL_LIMITS} depth, field, alias and cost limits
 * on each operation, expanding fragments (with a cycle guard; cycles are
 * reported by NoFragmentCyclesRule).
 */
export const QueryLimitsRule = (context: ValidationContext): ASTVisitor => {
  const limits = LEGACY_GRAPHQL_LIMITS;

  const walk = (
    selectionSet: SelectionSetNode,
    depth: number,
    path: Set<string>,
    stats: Stats,
    introspection: boolean,
  ): void => {
    for (const selection of selectionSet.selections) {
      stats.visited += 1;
      if (stats.visited > MAX_VISITED_SELECTIONS) throw new LimitExceeded();

      if (selection.kind === Kind.FIELD) {
        const name = selection.name.value;
        if (depth === 1) stats.cost += ROOT_FIELD_COST[name] ?? 1;
        stats.fields += 1;
        if (selection.alias && selection.alias.value !== name) stats.aliases += 1;
        // Every field counts, `__typename` and introspection included, but the
        // depth of introspection subtrees is MaxIntrospectionDepthRule's job.
        const inIntrospection = introspection || name.startsWith("__");
        if (!inIntrospection) stats.depth = Math.max(stats.depth, depth);
        if (selection.selectionSet) {
          walk(selection.selectionSet, depth + 1, path, stats, inIntrospection);
        }
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        walk(selection.selectionSet, depth, path, stats, introspection);
      } else {
        const fragmentName = selection.name.value;
        const fragment = context.getFragment(fragmentName);
        if (!fragment || path.has(fragmentName)) continue;
        path.add(fragmentName);
        walk(fragment.selectionSet, depth, path, stats, introspection);
        path.delete(fragmentName);
      }
    }
  };

  return {
    OperationDefinition(node) {
      const stats: Stats = { fields: 0, aliases: 0, depth: 0, cost: 0, visited: 0 };
      try {
        walk(node.selectionSet, 1, new Set(), stats, false);
      } catch (error) {
        if (!(error instanceof LimitExceeded)) throw error;
        context.reportError(
          new GraphQLError("Query is too complex: too many selections after expanding fragments.", {
            nodes: node,
          }),
        );
        return;
      }

      const problems: string[] = [];
      if (stats.depth > limits.maxDepth) {
        problems.push(`depth ${stats.depth} exceeds the maximum of ${limits.maxDepth}`);
      }
      if (stats.fields > limits.maxFields) {
        problems.push(`${stats.fields} fields exceed the maximum of ${limits.maxFields}`);
      }
      if (stats.aliases > limits.maxAliases) {
        problems.push(`${stats.aliases} aliases exceed the maximum of ${limits.maxAliases}`);
      }
      if (stats.cost > limits.maxCost) {
        problems.push(`cost ${stats.cost} exceeds the maximum of ${limits.maxCost}`);
      }
      for (const problem of problems) {
        context.reportError(new GraphQLError(`Query is too complex: ${problem}.`, { nodes: node }));
      }
    },
  };
};

/**
 * Validates a legacy GraphQL document in two passes. The cheap, linear
 * read-only and limit checks run first and stop the request on failure;
 * graphql-js's own rules (among them OverlappingFieldsCanBeMergedRule, which
 * is quadratic in sibling fields) only run on documents within the limits.
 */
export const validateLegacyDocument = (
  schema: GraphQLSchema,
  document: DocumentNode,
): readonly GraphQLError[] => {
  const limitErrors = validate(schema, document, [ReadOnlyOperationsRule, QueryLimitsRule]);
  if (limitErrors.length > 0) return limitErrors;
  return validate(schema, document, specifiedRules);
};
