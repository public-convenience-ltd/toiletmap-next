/**
 * Compares two introspection results while allowing exactly the removals the
 * read-only compatibility endpoint makes: the mutation root, the types only
 * the mutations used, and the `@auth` directive with its `Permission` enum.
 */

/** Types the legacy schema had and the read-only schema deliberately drops. */
export const REMOVED_LEGACY_TYPES = [
  "Mutation",
  "MutationResponse",
  "ReportMutationResponse",
  "ReportInput",
  "RemovalReportInput",
  "PointInput",
  "Permission",
] as const;

export const REMOVED_LEGACY_DIRECTIVES = ["auth"] as const;

type Named = { name: string };
type IntrospectionSchema = {
  queryType: Named | null;
  mutationType: Named | null;
  subscriptionType: Named | null;
  types: Named[];
  directives: Named[];
};

const byName = <T extends Named>(values: T[]) =>
  [...values].sort((a, b) => a.name.localeCompare(b.name));

/** The legacy introspection with the allowed removals applied, in a comparable order. */
export const expectedReadOnlySchema = (legacy: IntrospectionSchema): IntrospectionSchema => ({
  queryType: legacy.queryType,
  mutationType: null,
  subscriptionType: legacy.subscriptionType,
  types: byName(
    legacy.types.filter((type) => !(REMOVED_LEGACY_TYPES as readonly string[]).includes(type.name)),
  ),
  directives: byName(
    legacy.directives.filter(
      (directive) => !(REMOVED_LEGACY_DIRECTIVES as readonly string[]).includes(directive.name),
    ),
  ),
});

/** Our introspection in the same comparable order. */
export const comparableSchema = (schema: IntrospectionSchema): IntrospectionSchema => ({
  queryType: schema.queryType,
  mutationType: schema.mutationType,
  subscriptionType: schema.subscriptionType,
  types: byName(schema.types),
  directives: byName(schema.directives),
});
