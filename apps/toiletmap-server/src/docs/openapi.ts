import type {
  MediaTypeObject,
  OpenAPIObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from "openapi3-ts/oas31";
import { RECENT_WINDOW_DAYS } from "../common/constants";
import { LOO_ID_LENGTH } from "../services/loo";
import { REMOVAL_CATEGORIES } from "../services/loo/types";
import { openApiInfo, openApiServers, openApiTags } from "./config";

const schemaRef = (name: string): ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
});

const jsonContent = (schemaName: string): Record<string, MediaTypeObject> => ({
  "application/json": {
    schema: schemaRef(schemaName),
  },
});

const legacyGraphqlDescription =
  "Compatibility endpoint for clients of the old www.toiletmap.org.uk/api GraphQL API (the Flutter app, the GraphQL explorer, third parties); the site proxies `/api` and `/api/` here. The schema is frozen and read-only: any mutation is rejected with `This API is read-only; use the REST API.` Responses carry `Deprecation: true`, a `Link` to these docs and, once a date is set, `Sunset`. Use the REST endpoints for anything new. Limits: depth 8, 250 fields, 15 aliases, a cost budget per request, `loos` pages of at most 100, `looNamesByIds` of at most 100 ids, `maxDistance` up to 50,000 m, 32 KiB request bodies.";

const legacyGraphqlResponses = {
  200: {
    description:
      "A GraphQL response (`data` and/or `errors`). Validation and resolver errors also use 200, as the legacy API did.",
    content: { "application/json": { schema: { type: "object" as const } } },
  },
  400: { description: "Malformed request, or variables that do not match their types." },
  413: { description: "Query or request body too large." },
  429: { description: "Rate limited (shared with the other public reads)." },
};

const syncCursorSchema: SchemaObject = {
  type: "string",
  format: "date-time",
  description:
    "Server sync cursor: the database clock minus 120 seconds, read before the data was queried. Pass it back unchanged as `since` to `/api/loos/updates`; never substitute the client clock. The overlap means a row can be delivered twice, so apply updates idempotently.",
  example: "2026-11-17T09:58:00.000Z",
};

const etagHeader = (description: string) => ({
  description,
  schema: { type: "string" as const },
});

const cacheControlHeader = (value: string) => ({
  description: `\`${value}\``,
  schema: { type: "string" as const, example: value },
});

const ifNoneMatchParameter = {
  name: "If-None-Match",
  in: "header" as const,
  required: false,
  description: "An ETag from an earlier response. A match returns 304 with no body.",
  schema: { type: "string" as const },
};

const nullableBoolean: SchemaObject = { type: ["boolean", "null"] };
const nullableString = (maxLength?: number): SchemaObject => ({
  type: ["string", "null"],
  ...(maxLength ? { maxLength } : {}),
});
const nullableDateTime: SchemaObject = {
  type: ["string", "null"],
  format: "date-time",
};

const jsonValueSchema: SchemaObject = {
  description: "Arbitrary JSON value.",
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "array", items: {} },
    { type: "object", additionalProperties: true },
    { type: "null" },
  ],
};

const idSchemaInline: SchemaObject = {
  type: "string",
  minLength: LOO_ID_LENGTH,
  maxLength: LOO_ID_LENGTH,
  pattern: "^[a-f0-9]{24}$",
};

const schemas: Record<string, SchemaObject | ReferenceObject> = {
  Coordinates: {
    type: "object",
    description: "Geographic coordinates (WGS84).",
    properties: {
      lat: { type: "number", example: 51.5074 },
      lng: { type: "number", example: -0.1278 },
    },
    required: ["lat", "lng"],
  },
  DayOpeningHours: {
    anyOf: [
      {
        type: "array",
        description: "A day with opening hours: [open, close] in HH:mm format",
        items: { type: "string", pattern: "^([0-1][0-9]|2[0-3]):[0-5][0-9]$" },
        minItems: 2,
        maxItems: 2,
        example: ["09:00", "17:00"],
      },
      {
        type: "array",
        description: "A closed day represented as an empty array",
        maxItems: 0,
        example: [],
      },
    ],
  },
  OpeningTimes: {
    type: "array",
    description:
      'Opening times for each day of the week. Array has 7 elements: Monday (0) through Sunday (6). Each element is either ["HH:mm", "HH:mm"] for open days, or [] for closed days. If all opening times are unknown, the entire field is null.',
    items: schemaRef("DayOpeningHours"),
    minItems: 7,
    maxItems: 7,
    example: [
      ["09:00", "17:00"], // Monday
      ["09:00", "17:00"], // Tuesday
      ["09:00", "17:00"], // Wednesday
      ["09:00", "17:00"], // Thursday
      ["09:00", "17:00"], // Friday
      [], // Saturday (closed)
      [], // Sunday (closed)
    ],
  },
  AdminArea: {
    type: "object",
    description: "Administrative subdivision associated with a loo.",
    properties: {
      name: nullableString(),
      type: nullableString(),
    },
  },
  ErrorResponse: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string", example: "Route not found" },
    },
  },
  ValidationErrorResponse: {
    allOf: [
      schemaRef("ErrorResponse"),
      {
        type: "object",
        properties: {
          issues: {},
        },
      },
    ],
  },
  FeedbackRequest: {
    type: "object",
    required: ["text"],
    properties: {
      text: {
        type: "string",
        minLength: 1,
        maxLength: 5000,
        description: "The message (trimmed).",
      },
      email: {
        type: ["string", "null"],
        maxLength: 255,
        description: "Optional reply address. Empty means none. Never logged or sent to Slack.",
      },
      route: {
        type: ["string", "null"],
        maxLength: 255,
        description:
          "Page path or app version the message was sent from. Longer values are truncated.",
      },
      turnstileToken: {
        type: "string",
        maxLength: 2048,
        description: "Cloudflare Turnstile token; required only when the server enables Turnstile.",
      },
    },
  },
  HealthResponse: {
    type: "object",
    required: ["status", "service", "timestamp"],
    properties: {
      status: { type: "string", enum: ["ok"] },
      service: { type: "string", example: "toiletmap-server" },
      timestamp: { type: "string", format: "date-time", example: "2025-01-21T12:00:00.000Z" },
    },
  },
  JsonValue: jsonValueSchema,
  ReportDiffEntry: {
    type: "object",
    required: ["previous", "current"],
    properties: {
      previous: {
        anyOf: [schemaRef("JsonValue"), { type: "null" }],
      },
      current: {
        anyOf: [schemaRef("JsonValue"), { type: "null" }],
      },
    },
  },
  ReportDiff: {
    type: "object",
    additionalProperties: schemaRef("ReportDiffEntry"),
  },
  ReportSummary: {
    type: "object",
    required: ["id", "contributor", "createdAt", "diff"],
    properties: {
      id: { type: "string", example: "9234" },
      contributor: {
        anyOf: [{ type: "string", example: "jane.doe" }, { type: "null" }],
        description:
          "Contributor identifier. Null unless the caller provides an Auth0 admin token.",
      },
      createdAt: { type: "string", format: "date-time" },
      diff: {
        description: "Field-level changes introduced by the report.",
        anyOf: [schemaRef("ReportDiff"), { type: "null" }],
      },
    },
  },
  LooMutation: {
    type: "object",
    description: "Attributes accepted when creating or updating a loo.",
    properties: {
      name: nullableString(200),
      areaId: {
        ...nullableString(LOO_ID_LENGTH),
        minLength: LOO_ID_LENGTH,
        pattern: "^[a-f0-9]{24}$",
      },
      accessible: nullableBoolean,
      active: {
        type: "boolean",
        description:
          "Whether the loo is shown on the map. Must be true or false; null is rejected. Set false (with a removalReason) to remove a loo.",
      },
      allGender: nullableBoolean,
      attended: nullableBoolean,
      automatic: nullableBoolean,
      babyChange: nullableBoolean,
      children: nullableBoolean,
      men: nullableBoolean,
      women: nullableBoolean,
      urinalOnly: nullableBoolean,
      radar: nullableBoolean,
      notes: nullableString(2000),
      noPayment: nullableBoolean,
      paymentDetails: nullableString(2000),
      removalReason: nullableString(2000),
      openingTimes: {
        anyOf: [schemaRef("OpeningTimes"), { type: "null" }],
        description:
          'Opening times for each day of the week. Array has 7 elements: Monday (0) through Sunday (6). Each element is either ["HH:mm", "HH:mm"] for open days, or [] for closed days. If all opening times are unknown, the entire field is null.',
      },
      location: {
        description: "Optional location update. Null clears an existing location.",
        anyOf: [schemaRef("Coordinates"), { type: "null" }],
      },
    },
  },
  CreateLooRequest: {
    allOf: [
      schemaRef("LooMutation"),
      {
        type: "object",
        properties: {
          id: {
            type: "string",
            minLength: LOO_ID_LENGTH,
            maxLength: LOO_ID_LENGTH,
            pattern: "^[a-f0-9]{24}$",
            example: "0123456789abcdef01234567",
          },
        },
      },
    ],
  },
  UpdateLooRequest: {
    allOf: [
      schemaRef("LooMutation"),
      {
        type: "object",
        description:
          "Omitted fields are left unchanged; null clears a field. Fields equal to the stored value are ignored.",
        properties: {
          baseUpdatedAt: {
            type: "string",
            format: "date-time",
            description:
              "The `updatedAt` of the record the client loaded. If the record has changed since, the request fails with 409 and the current record.",
          },
        },
      },
    ],
  },
  ConflictResponse: {
    type: "object",
    required: ["message", "error", "current"],
    properties: {
      message: {
        type: "string",
        example: "This toilet was changed by someone else while you were editing.",
      },
      error: { type: "string", enum: ["conflict"] },
      current: schemaRef("Loo"),
    },
  },
  ReportLooRequest: {
    type: "object",
    required: ["reason"],
    additionalProperties: false,
    properties: {
      reason: {
        type: "string",
        enum: [...REMOVAL_CATEGORIES],
        description:
          "permanently_closed, does_not_exist (or in the wrong place), not_public, duplicate, or other.",
      },
      details: {
        type: "string",
        maxLength: 2000,
        description:
          "Free text, stored as `removalReason`. Required for `other`; otherwise a default sentence for the reason is stored.",
      },
      duplicateOf: {
        ...idSchemaInline,
        description:
          "Required for `duplicate` (and only allowed there): an active loo other than this one.",
      },
      baseUpdatedAt: {
        type: "string",
        format: "date-time",
        description: "The `updatedAt` the client loaded. A mismatch returns 409 `conflict`.",
      },
    },
  },
  RestoreLooRequest: {
    type: "object",
    additionalProperties: false,
    properties: {
      details: {
        type: "string",
        maxLength: 2000,
        description:
          "Optional note for the moderator. Kept on queued restores only; a direct (trusted) restore does not store it and answers with `detailsIgnored: true`.",
      },
      baseUpdatedAt: {
        type: "string",
        format: "date-time",
        description: "The `updatedAt` the client loaded. A mismatch returns 409 `conflict`.",
      },
    },
  },
  StateConflictResponse: {
    type: "object",
    required: ["message", "error", "current"],
    properties: {
      message: { type: "string" },
      error: { type: "string", enum: ["already_removed", "not_removed"] },
      current: schemaRef("Loo"),
    },
  },
  VerifyResponse: {
    type: "object",
    required: ["id", "verifiedAt"],
    properties: {
      id: { type: "string", example: "0123456789abcdef01234567" },
      verifiedAt: { type: "string", format: "date-time" },
    },
  },
  QueuedChangeResponse: {
    type: "object",
    required: ["queued"],
    properties: {
      queued: { type: "boolean" },
      id: { type: "string", format: "uuid", description: "Pending change id (when queued)." },
      unchanged: {
        type: "boolean",
        description: "True when the submission matched the current record and nothing was queued.",
      },
    },
  },
  Loo: {
    type: "object",
    required: ["id", "area", "reports", "contributorsCount"],
    properties: {
      id: {
        type: "string",
        minLength: LOO_ID_LENGTH,
        maxLength: LOO_ID_LENGTH,
        pattern: "^[a-f0-9]{24}$",
        example: "0123456789abcdef01234567",
      },
      geohash: nullableString(),
      name: nullableString(),
      area: {
        type: "array",
        items: schemaRef("AdminArea"),
        description: "Administrative areas linked to the loo.",
      },
      createdAt: nullableDateTime,
      updatedAt: nullableDateTime,
      verifiedAt: nullableDateTime,
      accessible: nullableBoolean,
      active: nullableBoolean,
      allGender: nullableBoolean,
      attended: nullableBoolean,
      automatic: nullableBoolean,
      babyChange: nullableBoolean,
      children: nullableBoolean,
      men: nullableBoolean,
      women: nullableBoolean,
      urinalOnly: nullableBoolean,
      notes: nullableString(),
      noPayment: nullableBoolean,
      paymentDetails: nullableString(),
      removalReason: nullableString(),
      removalCategory: {
        type: ["string", "null"],
        enum: [...REMOVAL_CATEGORIES, null],
        description: "Why the loo was removed from the map. Null while it is active.",
      },
      duplicateOf: {
        ...nullableString(LOO_ID_LENGTH),
        description: "For a removed duplicate, the id of the loo it duplicates.",
      },
      radar: nullableBoolean,
      openingTimes: {
        anyOf: [schemaRef("OpeningTimes"), { type: "null" }],
        description: "Opening hours for each day of the week, or null if completely unknown.",
      },
      reports: {
        type: "array",
        description: "Recent reports are populated on specific endpoints.",
        items: {},
      },
      contributorsCount: {
        type: "number",
        description: "Number of contributors recorded for the loo.",
        example: 4,
      },
      location: {
        anyOf: [schemaRef("Coordinates"), { type: "null" }],
      },
    },
  },
  NearbyLoo: {
    allOf: [
      schemaRef("Loo"),
      {
        type: "object",
        required: ["distance"],
        properties: {
          distance: {
            type: "number",
            description: "Distance from the requested point in meters.",
            example: 73.2,
          },
          active: {
            type: ["boolean", "null"],
            description:
              "False for removed loos, which are only returned with `includeInactive=true`.",
          },
        },
      },
    ],
  },
  Report: {
    type: "object",
    required: ["id", "contributor", "createdAt", "diff"],
    properties: {
      id: { type: "string", example: "9234" },
      contributor: {
        anyOf: [{ type: "string", example: "jane.doe" }, { type: "null" }],
        description:
          "Contributor identifier. Null unless the caller provides an Auth0 admin token.",
      },
      createdAt: { type: "string", format: "date-time" },
      verifiedAt: nullableDateTime,
      diff: {
        description: "Field-level changes introduced by the report.",
        anyOf: [schemaRef("ReportDiff"), { type: "null" }],
      },
      accessible: nullableBoolean,
      active: nullableBoolean,
      allGender: nullableBoolean,
      attended: nullableBoolean,
      automatic: nullableBoolean,
      babyChange: nullableBoolean,
      children: nullableBoolean,
      men: nullableBoolean,
      women: nullableBoolean,
      urinalOnly: nullableBoolean,
      notes: nullableString(),
      noPayment: nullableBoolean,
      paymentDetails: nullableString(),
      removalReason: nullableString(),
      removalCategory: {
        type: ["string", "null"],
        enum: [...REMOVAL_CATEGORIES, null],
        description: "Why the loo was removed from the map. Null while it is active.",
      },
      duplicateOf: {
        ...nullableString(LOO_ID_LENGTH),
        description: "For a removed duplicate, the id of the loo it duplicates.",
      },
      openingTimes: {
        anyOf: [schemaRef("OpeningTimes"), { type: "null" }],
      },
      geohash: nullableString(),
      radar: nullableBoolean,
      location: {
        anyOf: [schemaRef("Coordinates"), { type: "null" }],
      },
    },
  },
  AreaListResponse: {
    type: "object",
    required: ["data", "count"],
    properties: {
      data: {
        type: "array",
        items: schemaRef("AdminArea"),
      },
      count: { type: "number", example: 1 },
    },
  },
  LooListResponse: {
    type: "object",
    required: ["data", "count"],
    properties: {
      data: {
        type: "array",
        items: schemaRef("Loo"),
      },
      count: { type: "number", example: 2 },
    },
  },
  LooSearchResponse: {
    type: "object",
    required: ["data", "count", "total", "page", "pageSize", "hasMore"],
    properties: {
      data: {
        type: "array",
        items: schemaRef("Loo"),
      },
      count: { type: "number", example: 50 },
      total: { type: "number", example: 2500 },
      page: { type: "number", example: 1 },
      pageSize: { type: "number", example: 50 },
      hasMore: { type: "boolean", example: true },
    },
  },
  LooMetricsResponse: {
    type: "object",
    required: ["recentWindowDays", "totals", "areas"],
    properties: {
      recentWindowDays: {
        type: "number",
        description: "Number of days considered when computing recent updates.",
        example: 30,
      },
      totals: {
        type: "object",
        required: [
          "filtered",
          "active",
          "verified",
          "accessible",
          "babyChange",
          "radar",
          "freeAccess",
          "recent",
        ],
        properties: {
          filtered: { type: "number", example: 128 },
          active: { type: "number", example: 120 },
          verified: { type: "number", example: 45 },
          accessible: { type: "number", example: 80 },
          babyChange: { type: "number", example: 30 },
          radar: { type: "number", example: 22 },
          freeAccess: { type: "number", example: 90 },
          recent: {
            type: "number",
            description: "Records updated within the recentWindowDays timeframe.",
            example: 12,
          },
        },
      },
      areas: {
        type: "array",
        description: "Top areas by record count for the current filters.",
        items: {
          type: "object",
          required: ["name", "count"],
          properties: {
            areaId: nullableString(LOO_ID_LENGTH),
            name: { type: "string", example: "City of London" },
            count: { type: "number", example: 37 },
          },
        },
      },
    },
  },
  NearbyLooListResponse: {
    type: "object",
    required: ["data", "count"],
    properties: {
      data: {
        type: "array",
        items: schemaRef("NearbyLoo"),
      },
      count: { type: "number", example: 2 },
    },
  },
  ReportListResponse: {
    type: "object",
    required: ["data", "count"],
    properties: {
      data: {
        type: "array",
        description:
          "Summary report entries. Pass hydrate=true to receive full Report objects. Contributor fields are null unless the caller includes an Auth0 admin token.",
        items: schemaRef("ReportSummary"),
      },
      count: { type: "number", example: 2 },
    },
  },
  CompressedLoo: {
    type: "array",
    items: {
      oneOf: [
        { type: "string", description: "ID" },
        { type: "string", description: "Geohash" },
        { type: "number", description: "Filter Mask" },
      ],
    },
    minItems: 3,
    maxItems: 3,
    example: ["9234", "gcpvj", 3],
  },
  CompressedLooListResponse: {
    type: "object",
    required: ["data", "count"],
    properties: {
      data: {
        type: "array",
        items: schemaRef("CompressedLoo"),
      },
      count: { type: "number", example: 2 },
    },
  },
  DumpResponse: {
    type: "object",
    required: ["data", "count", "cursor"],
    properties: {
      data: {
        type: "array",
        items: schemaRef("CompressedLoo"),
      },
      count: { type: "number", example: 2 },
      cursor: syncCursorSchema,
    },
  },
  RichDumpResponse: {
    type: "object",
    required: ["data", "count", "cursor"],
    properties: {
      data: {
        type: "array",
        items: schemaRef("Loo"),
      },
      count: { type: "number", example: 2 },
      cursor: syncCursorSchema,
    },
  },
  SavedLooResponse: {
    allOf: [
      schemaRef("Loo"),
      {
        type: "object",
        required: ["compressed"],
        properties: {
          compressed: {
            oneOf: [schemaRef("CompressedLoo"), { type: "null" }],
            description:
              "The loo's map tuple, exactly as `/api/loos/dump` will serve it, so clients can patch a cached map immediately. `null` when the loo is not on the map (inactive or without a location).",
          },
        },
      },
    ],
  },
  RestoredLooResponse: {
    allOf: [
      schemaRef("SavedLooResponse"),
      {
        type: "object",
        properties: {
          detailsIgnored: {
            type: "boolean",
            enum: [true],
            description:
              "Present when the request carried `details`. Direct restores do not store the note; only queued restores keep it for the moderator.",
          },
        },
      },
    ],
  },
  UpdatesResponse: {
    type: "object",
    required: ["upserted", "deleted", "cursor"],
    properties: {
      upserted: {
        type: "array",
        items: schemaRef("CompressedLoo"),
        description: "Loos on the map that were created or updated after `since`.",
      },
      deleted: {
        type: "array",
        items: { type: "string" },
        description:
          "IDs of loos that left the map (deactivated or without a location) after `since`.",
        example: ["9234", "1234"],
      },
      cursor: syncCursorSchema,
    },
  },
};

const idSchema: SchemaObject = {
  type: "string",
  minLength: LOO_ID_LENGTH,
  maxLength: LOO_ID_LENGTH,
  pattern: "^[a-f0-9]{24}$",
};

const idPathParameter: ParameterObject = {
  name: "id",
  in: "path" as const,
  required: true,
  description: "24 character loo identifier.",
  schema: idSchema,
};

const authErrorResponse = {
  description: "Authentication required (Bearer token or session cookie).",
  content: jsonContent("ErrorResponse"),
};

const triStateFilterSchema = {
  type: "string",
  enum: ["true", "false", "unknown"],
} satisfies SchemaObject;

const booleanFilterSchema = {
  type: "string",
  enum: ["any", "true", "false"],
  default: "any",
} satisfies SchemaObject;

const sortFilterSchema = {
  type: "string",
  enum: [
    "updated-desc",
    "updated-asc",
    "created-desc",
    "created-asc",
    "verified-desc",
    "verified-asc",
    "name-asc",
    "name-desc",
  ],
  default: "updated-desc",
} satisfies SchemaObject;

const limitParamSchema = {
  type: "integer",
  minimum: 1,
  maximum: 200,
  default: 50,
} satisfies SchemaObject;

const pageParamSchema = {
  type: "integer",
  minimum: 1,
  maximum: 1000,
  default: 1,
} satisfies SchemaObject;

const searchFilterParameters: ParameterObject[] = [
  {
    name: "search",
    in: "query" as const,
    required: false,
    description: "Keyword search across id, name, geohash, and notes.",
    schema: { type: "string", maxLength: 200 } as SchemaObject,
  },
  {
    name: "areaName",
    in: "query" as const,
    required: false,
    description: "Matches administrative area name (case-insensitive).",
    schema: { type: "string", maxLength: 200 } as SchemaObject,
  },
  {
    name: "areaType",
    in: "query" as const,
    required: false,
    description: "Matches administrative area type (case-insensitive).",
    schema: { type: "string", maxLength: 100 } as SchemaObject,
  },
  {
    name: "active",
    in: "query" as const,
    required: false,
    description:
      "Active status. Omit to include all values, or use `unknown` for records where active status is not available.",
    schema: triStateFilterSchema,
  },
  {
    name: "accessible",
    in: "query" as const,
    required: false,
    description:
      "Whether the toilet is accessible. Omit to include all values, or use `unknown` for records where accessibility information is not available.",
    schema: triStateFilterSchema,
  },
  {
    name: "allGender",
    in: "query" as const,
    required: false,
    description:
      "Whether the toilet is all-gender. Omit to include all values, or use `unknown` for records where this information is not available.",
    schema: triStateFilterSchema,
  },
  {
    name: "radar",
    in: "query" as const,
    required: false,
    description:
      "Whether a RADAR key is required. Omit to include all values, or use `unknown` for records where RADAR key information is not available.",
    schema: triStateFilterSchema,
  },
  {
    name: "babyChange",
    in: "query" as const,
    required: false,
    description:
      "Whether baby change facilities are available. Omit to include all values, or use `unknown` for records where this information is not available.",
    schema: triStateFilterSchema,
  },
  {
    name: "noPayment",
    in: "query" as const,
    required: false,
    description:
      "Whether the toilet is free (no payment required). Omit to include all values, or use `unknown` for records where payment information is not available.",
    schema: triStateFilterSchema,
  },
  {
    name: "verified",
    in: "query" as const,
    required: false,
    description: "Verification status. Use `any` to include all values.",
    schema: booleanFilterSchema,
  },
  {
    name: "hasLocation",
    in: "query" as const,
    required: false,
    description:
      "Filter by whether the record has a known location. Use `any` to include all values.",
    schema: booleanFilterSchema,
  },
  {
    name: "sort",
    in: "query" as const,
    required: false,
    description: "Sort order for results.",
    schema: sortFilterSchema,
  },
  {
    name: "limit",
    in: "query" as const,
    required: false,
    description: "Maximum results per page (1–200, default 50).",
    schema: limitParamSchema,
  },
  {
    name: "page",
    in: "query" as const,
    required: false,
    description: "Page number (1-indexed, default 1).",
    schema: pageParamSchema,
  },
];

export const openApiDocument: OpenAPIObject = {
  openapi: "3.1.0",
  info: openApiInfo,
  servers: openApiServers,
  tags: openApiTags,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "An Auth0 access token for this API. A user's token writes loo data directly unless the user is blocked in Auth0. A machine-to-machine (client-credentials) token writes directly only when it carries `access:admin`; otherwise its changes are queued for moderation.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "access_token",
        description:
          "Session cookie issued via `/admin/login`. Contains a JWT tied to the user session and falls back to `id_token` when `access_token` is absent.",
      },
    },
    schemas,
  },
  paths: {
    "/": {
      get: {
        tags: ["Meta"],
        summary: "Service health check",
        responses: {
          200: {
            description: "Service is running.",
            content: jsonContent("HealthResponse"),
          },
        },
      },
    },
    "/api/feedback": {
      post: {
        tags: ["Feedback"],
        summary: "Send feedback to the Toilet Map team",
        description:
          "Public and unauthenticated. Accepts JSON or a URL-encoded form with the same fields (the legacy website and the Flutter app use these shapes). `email` is optional; an empty string means none. Unknown fields are ignored. Stored for the team; an excerpt of the text and the `route` (never the email or IP) may be posted to Slack. Rate limited per IP. When the server has a Turnstile secret configured, `turnstileToken` (or `cf-turnstile-response`) is required.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: schemaRef("FeedbackRequest") },
            "application/x-www-form-urlencoded": { schema: schemaRef("FeedbackRequest") },
          },
        },
        responses: {
          200: {
            description: "Stored. (200, not 201, for compatibility with the Flutter app.)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["ok", "message"],
                  properties: {
                    ok: { type: "boolean", const: true },
                    message: { type: "string", example: "Thank you for your feedback." },
                  },
                },
              },
            },
          },
          400: {
            description: "Missing or too-long text, an invalid email address, or a malformed body.",
            content: jsonContent("ValidationErrorResponse"),
          },
          403: {
            description: "Turnstile is enabled and the token is missing or invalid.",
            content: jsonContent("ErrorResponse"),
          },
          413: { description: "Body too large.", content: jsonContent("ErrorResponse") },
          415: {
            description: "Not JSON or a form.",
            content: jsonContent("ErrorResponse"),
          },
          429: { description: "Too many messages.", content: jsonContent("ErrorResponse") },
          503: {
            description: "Turnstile is enabled but could not be reached.",
            content: jsonContent("ErrorResponse"),
          },
        },
      },
    },
    "/api/geocode": {
      get: {
        tags: ["Geocoding"],
        summary: "Search for a place or postcode in Great Britain",
        description:
          "Public and unauthenticated; rate limited with the other reads, and explicit searches also per IP (20 a minute). Anything shaped like a UK postcode or outcode is looked up on postcodes.io first; everything else (and unknown postcodes) is searched on OpenStreetMap's Nominatim, limited to Great Britain. `mode=suggest` is for search-as-you-type: it only looks postcodes and outcodes up and never asks Nominatim, whose usage policy forbids autocomplete. Results are cached for 24 hours, keyed on the mode and the normalised query. Nominatim results carry OpenStreetMap's attribution, which must be shown with them.",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            description:
              "The place, address or postcode. Whitespace is collapsed and case ignored.",
            schema: { type: "string", minLength: 2, maxLength: 200, example: "SW1A 1AA" },
          },
          {
            name: "mode",
            in: "query",
            required: false,
            description:
              "`search` (the default: an explicit search, which may use Nominatim) or `suggest` (typing: postcodes and outcodes only, an empty list for anything else).",
            schema: { type: "string", enum: ["search", "suggest"], default: "search" },
          },
        ],
        responses: {
          200: {
            description: "Up to five results, best first. An empty list means nothing matched.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["results", "attribution"],
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["label", "lat", "lng", "kind"],
                        properties: {
                          label: { type: "string", example: "SW1A 1AA, Westminster" },
                          lat: { type: "number", example: 51.501009 },
                          lng: { type: "number", example: -0.141588 },
                          bbox: {
                            type: "array",
                            description: "The result's extent as [west, south, east, north].",
                            items: { type: "number" },
                            minItems: 4,
                            maxItems: 4,
                          },
                          kind: { type: "string", enum: ["postcode", "place"] },
                        },
                      },
                    },
                    attribution: {
                      type: ["string", "null"],
                      description:
                        "Attribution to show with the results, or null when none is needed.",
                      example:
                        "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright",
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Missing, too short or too long `q`, or an unknown `mode`.",
            content: jsonContent("ErrorResponse"),
          },
          429: {
            description:
              "Too many requests (the read limit, or the per-IP limit on explicit searches).",
            content: jsonContent("ErrorResponse"),
          },
          502: {
            description: "The upstream geocoder failed or timed out.",
            content: jsonContent("ErrorResponse"),
          },
          503: {
            description:
              "Place search is busy (Nominatim's one request a second is used up); retry after `Retry-After` seconds.",
            content: jsonContent("ErrorResponse"),
          },
        },
      },
    },
    "/api/areas": {
      get: {
        tags: ["Areas"],
        summary: "List administrative areas",
        responses: {
          200: {
            description: "Areas available for association with loos.",
            content: jsonContent("AreaListResponse"),
          },
        },
      },
    },
    "/api/graphql": {
      get: {
        tags: ["Legacy GraphQL"],
        deprecated: true,
        summary: "Legacy GraphQL API (read-only, frozen)",
        description: legacyGraphqlDescription,
        parameters: [
          {
            name: "query",
            in: "query" as const,
            required: true,
            description: "GraphQL query document (at most 10,000 characters).",
            schema: { type: "string" },
          },
          {
            name: "variables",
            in: "query" as const,
            required: false,
            description: "JSON-encoded variables object.",
            schema: { type: "string" },
          },
          {
            name: "operationName",
            in: "query" as const,
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: legacyGraphqlResponses,
      },
      post: {
        tags: ["Legacy GraphQL"],
        deprecated: true,
        summary: "Legacy GraphQL API (read-only, frozen)",
        description: legacyGraphqlDescription,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["query"],
                properties: {
                  query: { type: "string" },
                  variables: { type: "object", additionalProperties: true },
                  operationName: { type: "string" },
                },
              },
            },
          },
        },
        responses: legacyGraphqlResponses,
      },
    },
    "/api/loos": {
      get: {
        tags: ["Loos"],
        summary: "Fetch loos by ID",
        parameters: [
          {
            name: "ids",
            in: "query",
            required: true,
            description:
              "Comma separated IDs (?ids=a,b) or repeat the parameter (?ids=a&ids=b). Duplicates are ignored; at most 100 distinct ids, each 24 characters.",
            schema: {
              oneOf: [
                {
                  type: "string",
                  pattern: `^([a-f0-9]{${LOO_ID_LENGTH}})(,[a-f0-9]{${LOO_ID_LENGTH}})*$`,
                  example: "0123456789abcdef01234567,89abcdef0123456701234567",
                },
                {
                  type: "array",
                  items: {
                    type: "string",
                    minLength: LOO_ID_LENGTH,
                    maxLength: LOO_ID_LENGTH,
                    pattern: "^[a-f0-9]{24}$",
                  },
                  example: ["0123456789abcdef01234567", "89abcdef0123456701234567"],
                },
              ],
            },
            style: "form",
            explode: true,
          },
        ],
        responses: {
          200: {
            description: "Matching loos.",
            headers: { "Cache-Control": cacheControlHeader("private, max-age=60") },
            content: jsonContent("LooListResponse"),
          },
          400: {
            description: "Missing or invalid query parameters.",
            content: jsonContent("ValidationErrorResponse"),
          },
        },
      },
      post: {
        tags: ["Loos"],
        summary: "Create a loo",
        description:
          "Signed-in callers create the loo directly (201) unless they are blocked in Auth0. Anonymous and blocked callers have the new loo queued for moderation (202), as does anyone whose block status cannot be confirmed.",
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}],
        requestBody: {
          required: true,
          description: "Attributes to set for the new loo.",
          content: jsonContent("CreateLooRequest"),
        },
        responses: {
          201: {
            description: "Loo created. Includes its `compressed` map tuple.",
            content: jsonContent("SavedLooResponse"),
          },
          400: {
            description: "Invalid request payload.",
            content: jsonContent("ValidationErrorResponse"),
          },
          202: {
            description: "Queued for moderation.",
            content: jsonContent("QueuedChangeResponse"),
          },
          401: authErrorResponse,
          409: {
            description: "A loo with the supplied ID already exists.",
            content: jsonContent("ErrorResponse"),
          },
        },
      },
    },
    "/api/loos/updates": {
      get: {
        tags: ["Loos"],
        summary: "Fetch incremental updates",
        description:
          "Map changes since a sync cursor: loos created or updated (`upserted`) and loos that left the map (`deleted`). Pass the `cursor` from `/api/loos/dump` or the previous `/updates` response as `since`, and store the new `cursor` for next time. Never cached.",
        parameters: [
          {
            name: "since",
            in: "query",
            required: true,
            description:
              "A `cursor` returned by `/api/loos/dump` or `/api/loos/updates` (ISO 8601). Do not send the client clock.",
            schema: { type: "string", format: "date-time" },
          },
        ],
        responses: {
          200: {
            description: "Incremental updates and the next cursor.",
            headers: { "Cache-Control": cacheControlHeader("no-store") },
            content: jsonContent("UpdatesResponse"),
          },
          400: {
            description: "Invalid timestamp.",
            content: jsonContent("ValidationErrorResponse"),
          },
        },
      },
    },
    "/api/loos/{id}": {
      get: {
        tags: ["Loos"],
        summary: "Fetch a single loo",
        description:
          "Revalidated on every use: send the previous `ETag` as `If-None-Match` to get a 304 while the loo is unchanged.",
        parameters: [idPathParameter, ifNoneMatchParameter],
        responses: {
          200: {
            description: "Loo detail.",
            headers: {
              ETag: etagHeader(
                'Weak per-record version: `W/"loo-<id>-<updatedAt epoch ms>-<body hash>"`. Also changes when joined data such as the area name does.',
              ),
              "Cache-Control": cacheControlHeader("private, max-age=0, must-revalidate"),
            },
            content: jsonContent("Loo"),
          },
          304: {
            description: "Not modified: the `If-None-Match` ETag is current.",
          },
          400: {
            description: "Invalid loo identifier.",
            content: jsonContent("ValidationErrorResponse"),
          },
          404: {
            description: "Loo not found.",
            content: jsonContent("ErrorResponse"),
          },
        },
      },
      put: {
        tags: ["Loos"],
        summary: "Update (or create) a loo",
        description:
          "Signed-in callers write directly unless they are blocked in Auth0; an unknown id creates the loo. Anonymous and blocked callers (and anyone whose block status cannot be confirmed) can only suggest changes to existing loos: the changed fields are queued for moderation (202). Only fields that differ from the stored record are applied or queued. Reactivating a removed loo also clears its `removalCategory` and `duplicateOf`.",
        parameters: [idPathParameter],
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}],
        requestBody: {
          required: true,
          description: "Attributes to change.",
          content: jsonContent("UpdateLooRequest"),
        },
        responses: {
          200: {
            description:
              "Existing loo updated, or returned unchanged when nothing differed; both include the `compressed` map tuple. Anonymous or blocked callers' no-op submissions return `{ queued: false, unchanged: true }`.",
            content: {
              "application/json": {
                schema: {
                  anyOf: [schemaRef("SavedLooResponse"), schemaRef("QueuedChangeResponse")],
                },
              },
            },
          },
          201: {
            description: "New loo created. Includes its `compressed` map tuple.",
            content: jsonContent("SavedLooResponse"),
          },
          202: {
            description:
              "Change queued for moderation (anonymous, blocked in Auth0, or block status could not be confirmed).",
            content: jsonContent("QueuedChangeResponse"),
          },
          400: {
            description: "Invalid identifier or payload.",
            content: jsonContent("ValidationErrorResponse"),
          },
          401: authErrorResponse,
          404: {
            description: "Anonymous or blocked caller's change for a loo that does not exist.",
            content: jsonContent("ErrorResponse"),
          },
          409: {
            description: "The loo changed since `baseUpdatedAt`.",
            content: jsonContent("ConflictResponse"),
          },
          429: {
            description: "Too many writes.",
            content: jsonContent("ErrorResponse"),
          },
        },
      },
    },
    "/api/loos/{id}/report": {
      post: {
        tags: ["Loos"],
        summary: "Report a problem (remove a loo from the map)",
        description:
          "Signed-in callers who are not blocked in Auth0 remove the loo immediately: `active=false`, `removalCategory=reason`, `removalReason=details` (or a default sentence) and, for duplicates, `duplicateOf`. Everyone else queues a `remove` change for moderation, limited to one queued change a minute per caller.",
        parameters: [idPathParameter],
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}],
        requestBody: { required: true, content: jsonContent("ReportLooRequest") },
        responses: {
          200: {
            description: "Removed. `compressed` is null: drop the loo from any cached map.",
            content: jsonContent("SavedLooResponse"),
          },
          202: {
            description: "Queued for moderation.",
            content: jsonContent("QueuedChangeResponse"),
          },
          400: {
            description:
              "Invalid body: unknown reason, missing details for `other`, or a missing/invalid `duplicateOf` (unknown, removed, or this loo).",
            content: jsonContent("ValidationErrorResponse"),
          },
          404: { description: "Loo not found.", content: jsonContent("ErrorResponse") },
          409: {
            description:
              "`already_removed` (StateConflictResponse) or a stale `baseUpdatedAt` (`conflict`, ConflictResponse).",
            content: {
              "application/json": {
                schema: {
                  anyOf: [schemaRef("StateConflictResponse"), schemaRef("ConflictResponse")],
                },
              },
            },
          },
          429: { description: "Too many writes.", content: jsonContent("ErrorResponse") },
        },
      },
    },
    "/api/loos/{id}/restore": {
      post: {
        tags: ["Loos"],
        summary: "Restore a removed loo",
        description:
          "Signed-in callers who are not blocked in Auth0 put the loo back on the map and clear its removal category, reason and duplicate link (kept in the audit history). Everyone else queues a `restore` change. The body is optional.",
        parameters: [idPathParameter],
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}],
        requestBody: { required: false, content: jsonContent("RestoreLooRequest") },
        responses: {
          200: {
            description:
              "Restored, with its `compressed` map tuple. `detailsIgnored: true` when `details` was sent: direct restores do not store it.",
            content: jsonContent("RestoredLooResponse"),
          },
          202: {
            description: "Queued for moderation.",
            content: jsonContent("QueuedChangeResponse"),
          },
          400: { description: "Invalid body.", content: jsonContent("ValidationErrorResponse") },
          404: { description: "Loo not found.", content: jsonContent("ErrorResponse") },
          409: {
            description:
              "`not_removed` (StateConflictResponse) or a stale `baseUpdatedAt` (`conflict`, ConflictResponse).",
            content: {
              "application/json": {
                schema: {
                  anyOf: [schemaRef("StateConflictResponse"), schemaRef("ConflictResponse")],
                },
              },
            },
          },
          429: { description: "Too many writes.", content: jsonContent("ErrorResponse") },
        },
      },
    },
    "/api/loos/{id}/verify": {
      post: {
        tags: ["Loos"],
        summary: "Confirm a loo is still there",
        description:
          "Anyone may verify; anonymous callers are rate limited. Sets `verifiedAt` to now and changes nothing else (`updatedAt` is unchanged). No request body.",
        parameters: [idPathParameter],
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}],
        responses: {
          200: { description: "Verified.", content: jsonContent("VerifyResponse") },
          404: { description: "Loo not found.", content: jsonContent("ErrorResponse") },
          409: {
            description: "`removed`: the loo is not on the map.",
            content: jsonContent("ErrorResponse"),
          },
          429: { description: "Too many writes.", content: jsonContent("ErrorResponse") },
        },
      },
    },
    "/api/loos/{id}/reports": {
      get: {
        tags: ["Loos"],
        summary: "List reports for a loo",
        description:
          "Contributor identifiers are redacted unless the caller includes an Auth0 admin bearer token.",
        parameters: [
          idPathParameter,
          {
            name: "hydrate",
            in: "query",
            required: false,
            description: "Set to true to include full report snapshots instead of diffs.",
            schema: { type: "boolean", default: false },
          },
        ],
        responses: {
          200: {
            description:
              "Reports associated with the loo. Returns diffs by default; full records when hydrate=true.",
            content: jsonContent("ReportListResponse"),
          },
          400: {
            description: "Invalid loo identifier.",
            content: jsonContent("ValidationErrorResponse"),
          },
          401: {
            description:
              "Invalid authentication (Bearer token or session cookie). This endpoint is otherwise public.",
            content: jsonContent("ErrorResponse"),
          },
        },
      },
    },
    "/api/loos/dump": {
      get: {
        tags: ["Loos"],
        summary: "Dump all active loos",
        description:
          "Every active loo with a location, as compressed `[id, geohash, filterMask]` tuples (or full records with `rich=true`), plus a sync `cursor` for `/api/loos/updates`. Browsers may cache it for 60s and revalidate in the background for 300s more; edits made meanwhile arrive through `/updates`. The ETag is a dataset version, so `If-None-Match` revalidation is cheap.",
        parameters: [
          {
            name: "rich",
            in: "query",
            required: false,
            description:
              'Return full loo details instead of compressed tuples. WARNING: Large response size. Has its own ETag (`W/"dump-rich-..."`).',
            schema: { type: "boolean", default: false },
          },
          ifNoneMatchParameter,
        ],
        responses: {
          200: {
            description: "All active loos (compressed or full) and a sync cursor.",
            headers: {
              ETag: etagHeader(
                'Weak dataset version: `W/"dump-<max updated_at epoch ms>-<row count>-<sum of updated_at epoch µs>"`. Changes on every write, including out-of-order commits.',
              ),
              "Cache-Control": cacheControlHeader("public, max-age=60, stale-while-revalidate=300"),
            },
            content: {
              "application/json": {
                schema: {
                  oneOf: [schemaRef("DumpResponse"), schemaRef("RichDumpResponse")],
                },
              },
            },
          },
          304: {
            description:
              "Not modified: the dataset has not changed since the `If-None-Match` ETag. Keep the cached body and its cursor.",
          },
        },
      },
    },
    "/api/loos/geohash/{geohash}": {
      get: {
        tags: ["Loos"],
        summary: "List loos by geohash prefix",
        parameters: [
          {
            name: "geohash",
            in: "path",
            required: true,
            description:
              "Geohash prefix to match: 4-12 geohash (base32) characters, case-insensitive. Prefixes of exactly 4 characters take the stricter heavy-read rate limit.",
            schema: {
              type: "string",
              minLength: 4,
              maxLength: 12,
              pattern: "^[0-9bcdefghjkmnpqrstuvwxyzBCDEFGHJKMNPQRSTUVWXYZ]{4,12}$",
              example: "gcpvj",
            },
          },
          {
            name: "active",
            in: "query",
            required: false,
            description: "Filter loos by activity status. Use `any` to disable the filter.",
            schema: {
              type: "string",
              enum: ["true", "false", "any", "all"],
            },
          },
          {
            name: "compressed",
            in: "query",
            required: false,
            description:
              "Return compressed data optimized for map rendering. If true, returns CompressedLoo objects.",
            schema: {
              type: "boolean",
              default: false,
            },
          },
          {
            name: "summary",
            in: "query",
            required: false,
            description:
              "Return summary data (more detailed than compressed, less than full). If true, returns Loo objects.",
            schema: {
              type: "boolean",
              default: false,
            },
          },
        ],

        responses: {
          200: {
            description: "Loos matching the supplied geohash prefix.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [schemaRef("LooListResponse"), schemaRef("CompressedLooListResponse")],
                },
              },
            },
          },
        },
      },
    },
    "/api/loos/proximity": {
      get: {
        tags: ["Loos"],
        summary: "Find loos near a location",
        parameters: [
          {
            name: "lat",
            in: "query",
            required: true,
            description: "Latitude in decimal degrees.",
            schema: {
              type: "number",
              minimum: -90,
              maximum: 90,
              example: 51.5074,
            },
          },
          {
            name: "lng",
            in: "query",
            required: true,
            description: "Longitude in decimal degrees.",
            schema: {
              type: "number",
              minimum: -180,
              maximum: 180,
              example: -0.1278,
            },
          },
          {
            name: "radius",
            in: "query",
            required: false,
            description: "Search radius in meters (default 1000).",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 50000,
              default: 1000,
            },
          },
          {
            name: "includeInactive",
            in: "query",
            required: false,
            description:
              "Also return removed (inactive) loos, flagged `active: false`. Default: active loos only.",
            schema: { type: "boolean", default: false },
          },
          {
            name: "exclude",
            in: "query",
            required: false,
            description: "A loo id to leave out (e.g. the loo being edited).",
            schema: idSchemaInline,
          },
        ],
        responses: {
          200: {
            description: "Loos ordered by distance (nearest first). Cached for 60 seconds.",
            content: jsonContent("NearbyLooListResponse"),
          },
          400: {
            description: "Invalid query parameters.",
            content: jsonContent("ValidationErrorResponse"),
          },
        },
      },
    },
    "/api/loos/search": {
      get: {
        tags: ["Loos"],
        summary: "Search loos with filters",
        parameters: searchFilterParameters,
        responses: {
          200: {
            description: "Paged search results.",
            content: jsonContent("LooSearchResponse"),
          },
          400: {
            description: "Invalid query parameters.",
            content: jsonContent("ValidationErrorResponse"),
          },
        },
      },
    },
    "/api/loos/metrics": {
      get: {
        tags: ["Loos"],
        summary: "Retrieve aggregate metrics for filtered loos",
        description:
          "Returns counts and top-area information for the same query parameters accepted by `/api/loos/search`.",
        parameters: [
          ...searchFilterParameters,
          {
            name: "recentWindowDays",
            in: "query" as const,
            required: false,
            description:
              'Overrides the number of days considered when calculating the "recent" total (default 30, max 365).',
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 365,
              default: RECENT_WINDOW_DAYS,
            },
          },
        ],
        responses: {
          200: {
            description: "Aggregated metrics for the supplied filters.",
            content: jsonContent("LooMetricsResponse"),
          },
          400: {
            description: "Invalid query parameters.",
            content: jsonContent("ValidationErrorResponse"),
          },
        },
      },
    },
  },
};
