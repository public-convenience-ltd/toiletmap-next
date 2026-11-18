/**
 * Where the legacy GraphQL endpoint is mounted. Kept apart from the route so
 * middleware (logging, rate limiting) can recognise it without loading
 * graphql-js.
 */
export const LEGACY_GRAPHQL_PATH = "/api/graphql";

export const isLegacyGraphqlPath = (path: string): boolean => path === LEGACY_GRAPHQL_PATH;
