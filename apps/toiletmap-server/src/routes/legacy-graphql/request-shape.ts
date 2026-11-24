/**
 * What the legacy GraphQL endpoint derives from a parsed, validated document
 * before running it: the edge-cache key and whether it is a "wide" (heavy)
 * read that takes the stricter per-IP rate limit.
 */
import {
  type DocumentNode,
  type FieldNode,
  getOperationAST,
  Kind,
  type OperationDefinitionNode,
  print,
  type SelectionSetNode,
  type ValueNode,
  valueFromASTUntyped,
} from "graphql";
import { HEAVY_PROXIMITY_RADIUS } from "../../common/constants";
import { LEGACY_GRAPHQL_LIMITS } from "./limits";

type Variables = Record<string, unknown> | null | undefined;

/** JSON with object keys sorted at every level, so equal values serialise identically. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * Edge-cache key for a GET that will run `operationName` of `document`, or
 * null when no single operation is selected (that request fails anyway).
 *
 * Built from the parsed request, not the raw URL: the selected operation and
 * the fragments, re-printed (so whitespace, comments, commas, other
 * operations and parameter order make no difference), plus only the
 * variables that operation declares, in canonical JSON. Extra URL parameters
 * or unused variables therefore cannot mint new cache entries.
 */
export const legacyGraphqlCacheKey = async (
  origin: string,
  document: DocumentNode,
  operationName: string | undefined,
  variables: Variables,
): Promise<string | null> => {
  const operation = getOperationAST(document, operationName);
  if (!operation) return null;
  const used: Record<string, unknown> = {};
  for (const definition of operation.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    if (variables && Object.hasOwn(variables, name)) used[name] = variables[name];
  }
  const printed = print({
    ...document,
    definitions: document.definitions.filter(
      (definition) => definition === operation || definition.kind === Kind.FRAGMENT_DEFINITION,
    ),
  });
  const hash = await sha256Hex(`${printed}\n${canonicalJson(used)}`);
  return `${origin}/__cache/graphql/v1/${hash}`;
};

/** Root fields that always read a lot: paginated search, whole-dataset statistics, full tuples. */
const ALWAYS_WIDE_FIELDS = new Set(["loos", "statistics", "fullLoosByGeohash"]);

/** Root fields of the operation, looking through fragments (validated documents, so no cycles). */
const rootFields = (document: DocumentNode, operation: OperationDefinitionNode): FieldNode[] => {
  const fragments = new Map(
    document.definitions.flatMap((definition) =>
      definition.kind === Kind.FRAGMENT_DEFINITION
        ? [[definition.name.value, definition.selectionSet] as const]
        : [],
    ),
  );
  const fields: FieldNode[] = [];
  const seen = new Set<string>();
  const walk = (selectionSet: SelectionSetNode) => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) fields.push(selection);
      else if (selection.kind === Kind.INLINE_FRAGMENT) walk(selection.selectionSet);
      else {
        const name = selection.name.value;
        const fragment = fragments.get(name);
        if (fragment && !seen.has(name)) {
          seen.add(name);
          walk(fragment);
        }
      }
    }
  };
  walk(operation.selectionSet);
  return fields;
};

const argumentValue = (field: FieldNode, name: string, variables: Variables): unknown => {
  const node: ValueNode | undefined = field.arguments?.find(
    (argument) => argument.name.value === name,
  )?.value;
  return node ? valueFromASTUntyped(node, variables ?? undefined) : undefined;
};

/**
 * Whether the operation is a wide read: `loos`, `statistics` or
 * `fullLoosByGeohash`; `loosByGeohash` with a broad prefix (shorter than
 * {@link LEGACY_GRAPHQL_LIMITS.minPreciseGeohashLength}); or
 * `loosByProximity` beyond {@link HEAVY_PROXIMITY_RADIUS} metres. The Flutter
 * app's own request (proximity up to 5000 m) is never wide.
 */
export const isWideLegacyQuery = (
  document: DocumentNode,
  operationName: string | undefined,
  variables: Variables,
): boolean => {
  const operation = getOperationAST(document, operationName);
  if (!operation) return false;
  return rootFields(document, operation).some((field) => {
    const name = field.name.value;
    if (ALWAYS_WIDE_FIELDS.has(name)) return true;
    if (name === "loosByGeohash") {
      const geohash = argumentValue(field, "geohash", variables);
      return (
        typeof geohash === "string" &&
        geohash.length < LEGACY_GRAPHQL_LIMITS.minPreciseGeohashLength
      );
    }
    if (name === "loosByProximity") {
      const from = argumentValue(field, "from", variables);
      const maxDistance =
        from !== null && typeof from === "object"
          ? (from as Record<string, unknown>).maxDistance
          : undefined;
      return typeof maxDistance === "number" && maxDistance > HEAVY_PROXIMITY_RADIUS;
    }
    return false;
  });
};
