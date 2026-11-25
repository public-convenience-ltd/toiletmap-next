/**
 * Read-only compatibility endpoint for the legacy GraphQL API
 * (www.toiletmap.org.uk/api), mounted at `/api/graphql`. The client worker
 * routes the legacy `/api` and `/api/` URLs here.
 *
 * The contract is frozen to the golden fixtures in
 * test/fixtures/legacy-graphql: same schema (minus mutations), same output
 * encodings, same status codes and the same "Unexpected error." masking.
 * See README.md ("Legacy GraphQL compatibility endpoint").
 */
import {
  type DocumentNode,
  type ExecutionResult,
  execute,
  type FormattedExecutionResult,
  GraphQLError,
  type GraphQLFormattedError,
  getOperationAST,
  Kind,
  parse,
  print,
  visit,
} from "graphql";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { edgeCache } from "../../middleware/cache";
import { rateLimiters } from "../../middleware/cloudflare-rate-limit";
import { createPrismaClient, type PrismaClientInstance } from "../../prisma";
import type { AppVariables, Env } from "../../types";
import {
  fnv1a32,
  LEGACY_GRAPHQL_EDGE_TTL_SECONDS,
  LEGACY_GRAPHQL_GET_CACHE_CONTROL,
} from "../../utils/http-cache";
import { logger } from "../../utils/logger";
import { getLegacySchema } from "./executable-schema";
import { LEGACY_GRAPHQL_LIMITS, validateLegacyDocument } from "./limits";
import { isWideLegacyQuery, legacyGraphqlCacheKey } from "./request-shape";
import { type LegacyGraphqlContext, queryResolvers } from "./resolvers";

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export { isLegacyGraphqlPath, LEGACY_GRAPHQL_PATH } from "./path";

/**
 * Origins the legacy API answered CORS preflights for (its `cors` allow-list).
 * Simple GET/POST responses get `Access-Control-Allow-Origin: *` instead: the
 * legacy API reflected every origin there, and nothing here uses cookies.
 */
export const LEGACY_GRAPHQL_CORS_ORIGINS: readonly string[] = [
  "https://explorer.toiletmap.org.uk",
  "https://toiletmap-next-ui.vercel.app",
  "https://studio.apollographql.com",
  "http://localhost:6006",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8080",
];

const SAFE_HEADER_LIST = /^[A-Za-z0-9!#$%&'*+.^_`|~,\- ]{1,512}$/;

/**
 * CORS for the legacy endpoint, registered before the global security
 * headers (which skip CORS on this path). No credentials, ever.
 */
export const legacyGraphqlCors: MiddlewareHandler<{
  Bindings: Env;
  Variables: AppVariables;
}> = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    const headers = new Headers({ Vary: "Origin, Access-Control-Request-Headers" });
    const origin = c.req.header("origin");
    if (origin && LEGACY_GRAPHQL_CORS_ORIGINS.includes(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST");
      const requested = c.req.header("access-control-request-headers");
      if (requested && SAFE_HEADER_LIST.test(requested)) {
        headers.set("Access-Control-Allow-Headers", requested);
      }
      headers.set("Access-Control-Max-Age", "86400");
    }
    return new Response(null, { status: 204, headers });
  }

  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Expose-Headers", "Deprecation, Sunset, Link");
  // The response's Content-Type (and a request error's status) depends on
  // `Accept`, so shared caches must key public GET responses by it.
  c.header("Vary", "Accept", { append: true });
  await next();
};

/** Parses `GRAPHQL_SUNSET` (an HTTP-date) to an IMF-fixdate, or null when unset/invalid. */
export const sunsetHeaderValue = (value: string | undefined): string | null => {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toUTCString();
};

const ALLOW_HEADER = "GET, POST";
const NO_STORE = "no-store";
const UNEXPECTED_ERROR = "Unexpected error.";

/** Follows `originalError` down to the error that started it all. */
const isOriginalGraphQLError = (error: Error): boolean => {
  if (!(error instanceof GraphQLError)) return false;
  return error.originalError ? isOriginalGraphQLError(error.originalError) : true;
};

/**
 * The legacy server (graphql-yoga) masked every error that did not originate
 * as a GraphQLError, however deeply wrapped: resolver failures, scalar
 * failures and variable values a custom scalar rejected. Only message,
 * locations and path were kept.
 */
export const formatLegacyError = (error: GraphQLError): GraphQLFormattedError => {
  if (!isOriginalGraphQLError(error)) {
    return {
      message: UNEXPECTED_ERROR,
      ...(error.locations ? { locations: error.locations } : {}),
      ...(error.path ? { path: error.path } : {}),
    };
  }
  const { message, locations, path } = error.toJSON();
  return {
    message,
    ...(locations ? { locations } : {}),
    ...(path ? { path } : {}),
  };
};

const formatResult = (result: ExecutionResult): FormattedExecutionResult => ({
  ...(result.errors?.length ? { errors: result.errors.map(formatLegacyError) } : {}),
  ...("data" in result ? { data: result.data } : {}),
});

const PLACEHOLDER = { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: "_" } } as const;

/**
 * Hash of the document with every literal value replaced, so requests that
 * differ only in coordinates or ids (the Flutter app inlines them) share one
 * hash. Used for usage logging only.
 */
export const queryShapeHash = (document: DocumentNode): string => {
  const literal = () => PLACEHOLDER;
  const shape = visit(document, {
    IntValue: literal,
    FloatValue: literal,
    StringValue: literal,
    BooleanValue: literal,
    NullValue: literal,
  });
  return fnv1a32(print(shape));
};

type GraphqlParams = { query: unknown; variables: unknown; operationName: unknown };

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const parseJson = (text: string, message: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError(400, message);
  }
};

const readParams = async (c: AppContext): Promise<GraphqlParams> => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    const url = new URL(c.req.url);
    const variables = url.searchParams.get("variables");
    return {
      query: url.searchParams.get("query") ?? undefined,
      variables: variables ? parseJson(variables, "Variables are invalid JSON.") : undefined,
      operationName: url.searchParams.get("operationName") ?? undefined,
    };
  }

  const contentType = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  // The other POST encodings graphql-yoga accepted (multipart uploads aside).
  if (contentType === "application/graphql") {
    return { query: await c.req.text(), variables: undefined, operationName: undefined };
  }
  if (contentType === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(await c.req.text());
    const variables = form.get("variables");
    return {
      query: form.get("query") ?? undefined,
      variables: variables ? parseJson(variables, "Variables are invalid JSON.") : undefined,
      operationName: form.get("operationName") ?? undefined,
    };
  }
  if (
    contentType &&
    contentType !== "application/json" &&
    contentType !== "application/graphql+json"
  ) {
    throw new RequestError(415, "Unsupported Media Type");
  }
  const body = parseJson(await c.req.text(), "POST body sent invalid JSON.");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "POST body is expected to be an object.");
  }
  const { query, variables, operationName } = body as Record<string, unknown>;
  return {
    query,
    variables:
      typeof variables === "string"
        ? parseJson(variables, "Variables are invalid JSON.")
        : variables,
    operationName,
  };
};

type Outcome = {
  status: number;
  body: FormattedExecutionResult | { errors: GraphQLFormattedError[] };
  cacheable: boolean;
  headers?: Record<string, string>;
};

const handleLegacyGraphql = async (c: AppContext): Promise<Response> => {
  const method = c.req.method;
  const wantsGraphqlResponse = (c.req.header("accept") ?? "").includes(
    "application/graphql-response+json",
  );
  const contentType = wantsGraphqlResponse
    ? "application/graphql-response+json; charset=utf-8"
    : "application/json; charset=utf-8";
  // With the newer media type, a request that never executed is a 400; with
  // plain JSON the legacy server answered 200 (variable errors aside).
  const requestErrorStatus = wantsGraphqlResponse ? 400 : 200;
  const isGet = method === "GET" || method === "HEAD";

  let document: DocumentNode | undefined;
  let operationName: string | undefined;

  /** What gets logged about each request: no IP, user agent or variables. */
  const usage = () => ({
    operationName:
      operationName ??
      (document ? getOperationAST(document, undefined)?.name?.value : undefined) ??
      null,
    rootFields: document ? rootFieldNames(document, operationName) : [],
    queryHash: document ? queryShapeHash(document) : null,
    origin: c.req.header("origin") ?? null,
  });

  const send = ({ status, body, cacheable, headers = {} }: Outcome): Response => {
    logger.info("Legacy GraphQL request", {
      method,
      status,
      ...usage(),
      errorCount: "errors" in body && body.errors ? body.errors.length : 0,
    });
    const responseHeaders = {
      "Content-Type": contentType,
      "Cache-Control": cacheable ? LEGACY_GRAPHQL_GET_CACHE_CONTROL : NO_STORE,
      ...headers,
    };
    const code = status as ContentfulStatusCode;
    return method === "HEAD"
      ? c.body(null, code, responseHeaders)
      : c.body(JSON.stringify(body), code, responseHeaders);
  };

  const requestError = (status: number, message: string, headers?: Record<string, string>) =>
    send({ status, body: { errors: [{ message }] }, cacheable: false, headers });

  if (!isGet && method !== "POST") {
    return requestError(405, `Method ${method} is not allowed.`, { Allow: ALLOW_HEADER });
  }

  let params: GraphqlParams;
  try {
    params = await readParams(c);
  } catch (error) {
    if (error instanceof RequestError) return requestError(error.status, error.message);
    throw error;
  }

  const { query, variables } = params;
  if (query === undefined || query === null || query === "") {
    return requestError(requestErrorStatus, "Must provide query string.", { Allow: ALLOW_HEADER });
  }
  if (typeof query !== "string") return requestError(400, "Query must be a string.");
  if (query.length > LEGACY_GRAPHQL_LIMITS.maxQueryLength) {
    return requestError(413, "Query is too large.");
  }
  if (params.operationName != null && typeof params.operationName !== "string") {
    return requestError(400, "Operation name must be a string.");
  }
  operationName = (params.operationName as string | null | undefined) || undefined;
  if (variables != null && (typeof variables !== "object" || Array.isArray(variables))) {
    return requestError(400, "Variables must be an object.");
  }

  const schema = getLegacySchema();
  try {
    document = parse(query, { maxTokens: LEGACY_GRAPHQL_LIMITS.maxTokens });
  } catch (error) {
    if (!(error instanceof GraphQLError)) throw error;
    return send({
      status: requestErrorStatus,
      body: { errors: [formatLegacyError(error)] },
      cacheable: false,
    });
  }

  const validationErrors = validateLegacyDocument(schema, document);
  if (validationErrors.length > 0) {
    return send({
      status: requestErrorStatus,
      body: { errors: validationErrors.map(formatLegacyError) },
      cacheable: false,
    });
  }

  const variableValues = (variables as Record<string, unknown> | null | undefined) ?? undefined;

  // Wide reads take the stricter per-IP limit (cache hits included).
  if (isWideLegacyQuery(document, operationName, variableValues)) {
    const limited = await rateLimiters.heavyRead(c, async () => {
      // Allowed: carry on below.
    });
    if (limited) {
      return requestError(429, "Too many large requests, please try again in a minute.");
    }
  }

  // Keyed by the parsed request, never the raw URL (see legacyGraphqlCacheKey).
  const cacheKey =
    isGet && !wantsGraphqlResponse
      ? await legacyGraphqlCacheKey(
          new URL(c.req.url).origin,
          document,
          operationName,
          variableValues,
        )
      : null;
  if (cacheKey) {
    const hit = await edgeCache.match(c, cacheKey);
    if (hit) {
      logger.info("Legacy GraphQL request", {
        method,
        status: hit.status,
        ...usage(),
        cache: "hit",
      });
      return method === "HEAD" ? new Response(null, hit) : hit;
    }
  }

  let prisma: PrismaClientInstance | undefined;
  const contextValue: LegacyGraphqlContext = {
    looService: c.get("looService"),
    broadGeohashReads: 0,
    getPrisma: () => {
      if (!prisma) {
        const connectionString =
          c.env.HYPERDRIVE?.connectionString ?? c.env.TEST_HYPERDRIVE?.connectionString;
        if (!connectionString) throw new Error("No database connection string available");
        prisma = createPrismaClient(connectionString);
      }
      return prisma;
    },
  };

  const result = await execute({
    schema,
    document,
    rootValue: queryResolvers,
    contextValue,
    variableValues,
    operationName,
  });

  const formatted = formatResult(result);
  // No `data` means the request failed before execution (variable coercion,
  // unknown operation name); the legacy server answered those with 400.
  const executed = "data" in result;
  const cacheable = isGet && executed && !result.errors?.length;
  const response = send({ status: executed ? 200 : 400, body: formatted, cacheable });

  // Only a GET carries the body worth storing (a HEAD response has none).
  if (cacheable && cacheKey && method === "GET") {
    try {
      edgeCache.put(c, cacheKey, response, LEGACY_GRAPHQL_EDGE_TTL_SECONDS);
    } catch {
      // No ExecutionContext (unit tests): caching is only an optimisation.
    }
  }
  return response;
};

/** Root field names of the operation that runs (for usage logging). */
const rootFieldNames = (document: DocumentNode, operationName: string | undefined): string[] => {
  const operation = getOperationAST(document, operationName);
  if (!operation) return [];
  return operation.selectionSet.selections.flatMap((selection) =>
    selection.kind === Kind.FIELD ? [selection.name.value] : [],
  );
};

export const legacyGraphqlRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

legacyGraphqlRouter.use("*", async (c, next) => {
  // RFC 9745 `Deprecation`, RFC 8288 `Link` to the replacement, RFC 8594
  // `Sunset` once a date is configured.
  c.header("Deprecation", "true");
  c.header(
    "Link",
    `<${new URL("/api/docs", c.req.url).href}>; rel="deprecation"; type="text/html"`,
  );
  const sunset = sunsetHeaderValue(c.env.GRAPHQL_SUNSET);
  if (sunset) c.header("Sunset", sunset);
  await next();
});

legacyGraphqlRouter.post(
  "/",
  bodyLimit({
    maxSize: LEGACY_GRAPHQL_LIMITS.maxBodyBytes,
    onError: (c) =>
      c.json({ errors: [{ message: "Request body is too large." }] }, 413, {
        "Cache-Control": NO_STORE,
      }),
  }),
);

legacyGraphqlRouter.all("/", handleLegacyGraphql);
