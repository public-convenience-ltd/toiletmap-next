import { LOO_ID_LENGTH } from '../services/loo';
import { RECENT_WINDOW_DAYS } from '../common/constants';
import { openApiInfo, openApiServers, openApiTags } from './config';

import type {
  MediaTypeObject,
  OpenAPIObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

const schemaRef = (name: string): ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
});

const jsonContent = (schemaName: string): Record<string, MediaTypeObject> => ({
  'application/json': {
    schema: schemaRef(schemaName),
  },
});

const nullableBoolean: SchemaObject = { type: ['boolean', 'null'] };
const nullableString = (maxLength?: number): SchemaObject => ({
  type: ['string', 'null'],
  ...(maxLength ? { maxLength } : {}),
});
const nullableDateTime: SchemaObject = {
  type: ['string', 'null'],
  format: 'date-time',
};

const jsonValueSchema: SchemaObject = {
  description: 'Arbitrary JSON value.',
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'array', items: {} },
    { type: 'object', additionalProperties: true },
    { type: 'null' },
  ],
};

const schemas: Record<string, SchemaObject | ReferenceObject> = {
  Coordinates: {
    type: 'object',
    description: 'Geographic coordinates (WGS84).',
    properties: {
      lat: { type: 'number', example: 51.5074 },
      lng: { type: 'number', example: -0.1278 },
    },
    required: ['lat', 'lng'],
  },
  DayOpeningHours: {
    anyOf: [
      {
        type: 'array',
        description: 'A day with opening hours: [open, close] in HH:mm format',
        items: { type: 'string', pattern: '^([0-1][0-9]|2[0-3]):[0-5][0-9]$' },
        minItems: 2,
        maxItems: 2,
        example: ['09:00', '17:00'],
      },
      {
        type: 'array',
        description: 'A closed day represented as an empty array',
        maxItems: 0,
        example: [],
      },
    ],
  },
  OpeningTimes: {
    type: 'array',
    description:
      'Opening times for each day of the week. Array has 7 elements: Monday (0) through Sunday (6). Each element is either ["HH:mm", "HH:mm"] for open days, or [] for closed days. If all opening times are unknown, the entire field is null.',
    items: schemaRef('DayOpeningHours'),
    minItems: 7,
    maxItems: 7,
    example: [
      ['09:00', '17:00'], // Monday
      ['09:00', '17:00'], // Tuesday
      ['09:00', '17:00'], // Wednesday
      ['09:00', '17:00'], // Thursday
      ['09:00', '17:00'], // Friday
      [], // Saturday (closed)
      [], // Sunday (closed)
    ],
  },
  AdminArea: {
    type: 'object',
    description: 'Administrative subdivision associated with a loo.',
    properties: {
      name: nullableString(),
      type: nullableString(),
    },
  },
  ErrorResponse: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', example: 'Route not found' },
    },
  },
  ValidationErrorResponse: {
    allOf: [
      schemaRef('ErrorResponse'),
      {
        type: 'object',
        properties: {
          issues: {},
        },
      },
    ],
  },
  HealthResponse: {
    type: 'object',
    required: ['status', 'service', 'timestamp'],
    properties: {
      status: { type: 'string', enum: ['ok'] },
      service: { type: 'string', example: 'toiletmap-server' },
      timestamp: { type: 'string', format: 'date-time', example: '2025-01-21T12:00:00.000Z' },
    },
  },
  JsonValue: jsonValueSchema,
  ReportDiffEntry: {
    type: 'object',
    required: ['previous', 'current'],
    properties: {
      previous: {
        anyOf: [schemaRef('JsonValue'), { type: 'null' }],
      },
      current: {
        anyOf: [schemaRef('JsonValue'), { type: 'null' }],
      },
    },
  },
  ReportDiff: {
    type: 'object',
    additionalProperties: schemaRef('ReportDiffEntry'),
  },
  ReportSummary: {
    type: 'object',
    required: ['id', 'contributor', 'createdAt', 'diff'],
    properties: {
      id: { type: 'string', example: '9234' },
      contributor: {
        anyOf: [
          { type: 'string', example: 'jane.doe' },
          { type: 'null' },
        ],
        description:
          'Contributor identifier. Null unless the caller provides an Auth0 admin token.',
      },
      createdAt: { type: 'string', format: 'date-time' },
      diff: {
        description: 'Field-level changes introduced by the report.',
        anyOf: [schemaRef('ReportDiff'), { type: 'null' }],
      },
    },
  },
  LooMutation: {
    type: 'object',
    description: 'Attributes accepted when creating or updating a loo.',
    properties: {
      name: nullableString(200),
      areaId: {
        ...nullableString(LOO_ID_LENGTH),
        minLength: LOO_ID_LENGTH,
        pattern: '^[a-f0-9]{24}$',
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
      radar: nullableBoolean,
      notes: nullableString(2000),
      noPayment: nullableBoolean,
      paymentDetails: nullableString(2000),
      removalReason: nullableString(2000),
      openingTimes: {
        anyOf: [schemaRef('OpeningTimes'), { type: 'null' }],
        description:
          'Opening times for each day of the week. Array has 7 elements: Monday (0) through Sunday (6). Each element is either ["HH:mm", "HH:mm"] for open days, or [] for closed days. If all opening times are unknown, the entire field is null.',
      },
      location: {
        description:
          'Optional location update. Null clears an existing location.',
        anyOf: [schemaRef('Coordinates'), { type: 'null' }],
      },
    },
  },
  CreateLooRequest: {
    allOf: [
      schemaRef('LooMutation'),
      {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            minLength: LOO_ID_LENGTH,
            maxLength: LOO_ID_LENGTH,
            pattern: '^[a-f0-9]{24}$',
            example: '0123456789abcdef01234567',
          },
        },
      },
    ],
  },
  UpdateLooRequest: schemaRef('LooMutation'),
  Loo: {
    type: 'object',
    required: ['id', 'area', 'reports', 'contributorsCount'],
    properties: {
      id: {
        type: 'string',
        minLength: LOO_ID_LENGTH,
        maxLength: LOO_ID_LENGTH,
        pattern: '^[a-f0-9]{24}$',
        example: '0123456789abcdef01234567',
      },
      geohash: nullableString(),
      name: nullableString(),
      area: {
        type: 'array',
        items: schemaRef('AdminArea'),
        description: 'Administrative areas linked to the loo.',
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
      radar: nullableBoolean,
      openingTimes: {
        anyOf: [schemaRef('OpeningTimes'), { type: 'null' }],
        description: 'Opening hours for each day of the week, or null if completely unknown.',
      },
      reports: {
        type: 'array',
        description: 'Recent reports are populated on specific endpoints.',
        items: {},
      },
      contributorsCount: {
        type: 'number',
        description: 'Number of contributors recorded for the loo.',
        example: 4,
      },
      location: {
        anyOf: [schemaRef('Coordinates'), { type: 'null' }],
      },
    },
  },
  NearbyLoo: {
    allOf: [
      schemaRef('Loo'),
      {
        type: 'object',
        required: ['distance'],
        properties: {
          distance: {
            type: 'number',
            description: 'Distance from the requested point in meters.',
            example: 73.2,
          },
        },
      },
    ],
  },
  Report: {
    type: 'object',
    required: ['id', 'contributor', 'createdAt', 'diff'],
    properties: {
      id: { type: 'string', example: '9234' },
      contributor: {
        anyOf: [
          { type: 'string', example: 'jane.doe' },
          { type: 'null' },
        ],
        description:
          'Contributor identifier. Null unless the caller provides an Auth0 admin token.',
      },
      createdAt: { type: 'string', format: 'date-time' },
      verifiedAt: nullableDateTime,
      diff: {
        description: 'Field-level changes introduced by the report.',
        anyOf: [schemaRef('ReportDiff'), { type: 'null' }],
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
      openingTimes: {
        anyOf: [schemaRef('OpeningTimes'), { type: 'null' }],
      },
      geohash: nullableString(),
      radar: nullableBoolean,
      location: {
        anyOf: [schemaRef('Coordinates'), { type: 'null' }],
      },
    },
  },
  AreaListResponse: {
    type: 'object',
    required: ['data', 'count'],
    properties: {
      data: {
        type: 'array',
        items: schemaRef('AdminArea'),
      },
      count: { type: 'number', example: 1 },
    },
  },
  LooListResponse: {
    type: 'object',
    required: ['data', 'count'],
    properties: {
      data: {
        type: 'array',
        items: schemaRef('Loo'),
      },
      count: { type: 'number', example: 2 },
    },
  },
  LooSearchResponse: {
    type: 'object',
    required: ['data', 'count', 'total', 'page', 'pageSize', 'hasMore'],
    properties: {
      data: {
        type: 'array',
        items: schemaRef('Loo'),
      },
      count: { type: 'number', example: 50 },
      total: { type: 'number', example: 2500 },
      page: { type: 'number', example: 1 },
      pageSize: { type: 'number', example: 50 },
      hasMore: { type: 'boolean', example: true },
    },
  },
  LooMetricsResponse: {
    type: 'object',
    required: ['recentWindowDays', 'totals', 'areas'],
    properties: {
      recentWindowDays: {
        type: 'number',
        description: 'Number of days considered when computing recent updates.',
        example: 30,
      },
      totals: {
        type: 'object',
        required: [
          'filtered',
          'active',
          'verified',
          'accessible',
          'babyChange',
          'radar',
          'freeAccess',
          'recent',
        ],
        properties: {
          filtered: { type: 'number', example: 128 },
          active: { type: 'number', example: 120 },
          verified: { type: 'number', example: 45 },
          accessible: { type: 'number', example: 80 },
          babyChange: { type: 'number', example: 30 },
          radar: { type: 'number', example: 22 },
          freeAccess: { type: 'number', example: 90 },
          recent: {
            type: 'number',
            description: 'Records updated within the recentWindowDays timeframe.',
            example: 12,
          },
        },
      },
      areas: {
        type: 'array',
        description: 'Top areas by record count for the current filters.',
        items: {
          type: 'object',
          required: ['name', 'count'],
          properties: {
            areaId: nullableString(LOO_ID_LENGTH),
            name: { type: 'string', example: 'City of London' },
            count: { type: 'number', example: 37 },
          },
        },
      },
    },
  },
  NearbyLooListResponse: {
    type: 'object',
    required: ['data', 'count'],
    properties: {
      data: {
        type: 'array',
        items: schemaRef('NearbyLoo'),
      },
      count: { type: 'number', example: 2 },
    },
  },
  ReportListResponse: {
    type: 'object',
    required: ['data', 'count'],
    properties: {
      data: {
        type: 'array',
        description:
          'Summary report entries. Pass hydrate=true to receive full Report objects. Contributor fields are null unless the caller includes an Auth0 admin token.',
        items: schemaRef('ReportSummary'),
      },
      count: { type: 'number', example: 2 },
    },
  },
  CompressedLoo: {
    type: 'array',
    items: {
      oneOf: [
        { type: 'string', description: 'ID' },
        { type: 'string', description: 'Geohash' },
        { type: 'number', description: 'Filter Mask' },
      ],
    },
    minItems: 3,
    maxItems: 3,
    example: ['9234', 'gcpvj', 3],
  },
  CompressedLooListResponse: {
    type: 'object',
    required: ['data', 'count'],
    properties: {
      data: {
        type: 'array',
        items: schemaRef('CompressedLoo'),
      },
      count: { type: 'number', example: 2 },
    },
  },
};

const idSchema: SchemaObject = {
  type: 'string',
  minLength: LOO_ID_LENGTH,
  maxLength: LOO_ID_LENGTH,
  pattern: '^[a-f0-9]{24}$',
};

const idPathParameter: ParameterObject = {
  name: 'id',
  in: 'path' as const,
  required: true,
  description: '24 character loo identifier.',
  schema: idSchema,
};

const authErrorResponse = {
  description: 'Authentication required (Bearer token or session cookie).',
  content: jsonContent('ErrorResponse'),
};

const triStateFilterSchema = {
  type: 'string',
  enum: ['true', 'false', 'unknown'],
} satisfies SchemaObject;

const booleanFilterSchema = {
  type: 'string',
  enum: ['any', 'true', 'false'],
  default: 'any',
} satisfies SchemaObject;

const sortFilterSchema = {
  type: 'string',
  enum: [
    'updated-desc',
    'updated-asc',
    'created-desc',
    'created-asc',
    'verified-desc',
    'verified-asc',
    'name-asc',
    'name-desc',
  ],
  default: 'updated-desc',
} satisfies SchemaObject;

const limitParamSchema = {
  type: 'integer',
  minimum: 1,
  maximum: 200,
  default: 50,
} satisfies SchemaObject;

const pageParamSchema = {
  type: 'integer',
  minimum: 1,
  default: 1,
} satisfies SchemaObject;

const searchFilterParameters: ParameterObject[] = [
  {
    name: 'search',
    in: 'query' as const,
    required: false,
    description: 'Keyword search across id, name, geohash, and notes.',
    schema: { type: 'string', maxLength: 200 } as SchemaObject,
  },
  {
    name: 'areaName',
    in: 'query' as const,
    required: false,
    description: 'Matches administrative area name (case-insensitive).',
    schema: { type: 'string', maxLength: 200 } as SchemaObject,
  },
  {
    name: 'areaType',
    in: 'query' as const,
    required: false,
    description: 'Matches administrative area type (case-insensitive).',
    schema: { type: 'string', maxLength: 100 } as SchemaObject,
  },
  {
    name: 'active',
    in: 'query' as const,
    required: false,
    description:
      'Active status. Omit to include all values, or use `unknown` for records where active status is not available.',
    schema: triStateFilterSchema,
  },
  {
    name: 'accessible',
    in: 'query' as const,
    required: false,
    description:
      'Whether the toilet is accessible. Omit to include all values, or use `unknown` for records where accessibility information is not available.',
    schema: triStateFilterSchema,
  },
  {
    name: 'allGender',
    in: 'query' as const,
    required: false,
    description:
      'Whether the toilet is all-gender. Omit to include all values, or use `unknown` for records where this information is not available.',
    schema: triStateFilterSchema,
  },
  {
    name: 'radar',
    in: 'query' as const,
    required: false,
    description:
      'Whether a RADAR key is required. Omit to include all values, or use `unknown` for records where RADAR key information is not available.',
    schema: triStateFilterSchema,
  },
  {
    name: 'babyChange',
    in: 'query' as const,
    required: false,
    description:
      'Whether baby change facilities are available. Omit to include all values, or use `unknown` for records where this information is not available.',
    schema: triStateFilterSchema,
  },
  {
    name: 'noPayment',
    in: 'query' as const,
    required: false,
    description:
      'Whether the toilet is free (no payment required). Omit to include all values, or use `unknown` for records where payment information is not available.',
    schema: triStateFilterSchema,
  },
  {
    name: 'verified',
    in: 'query' as const,
    required: false,
    description: 'Verification status. Use `any` to include all values.',
    schema: booleanFilterSchema,
  },
  {
    name: 'hasLocation',
    in: 'query' as const,
    required: false,
    description:
      'Filter by whether the record has a known location. Use `any` to include all values.',
    schema: booleanFilterSchema,
  },
  {
    name: 'sort',
    in: 'query' as const,
    required: false,
    description: 'Sort order for results.',
    schema: sortFilterSchema,
  },
  {
    name: 'limit',
    in: 'query' as const,
    required: false,
    description: 'Maximum results per page (1–200, default 50).',
    schema: limitParamSchema,
  },
  {
    name: 'page',
    in: 'query' as const,
    required: false,
    description: 'Page number (1-indexed, default 1).',
    schema: pageParamSchema,
  },
];

export const openApiDocument: OpenAPIObject = {
  openapi: '3.1.0',
  info: openApiInfo,
  servers: openApiServers,
  tags: openApiTags,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
        description:
          'Session cookie issued via `/admin/login`. Contains a JWT tied to the user session and falls back to `id_token` when `access_token` is absent.',
      },
    },
    schemas,
  },
  paths: {
    '/': {
      get: {
        tags: ['Meta'],
        summary: 'Service health check',
        responses: {
          200: {
            description: 'Service is running.',
            content: jsonContent('HealthResponse'),
          },
        },
      },
    },
    '/api/areas': {
      get: {
        tags: ['Areas'],
        summary: 'List administrative areas',
        responses: {
          200: {
            description: 'Areas available for association with loos.',
            content: jsonContent('AreaListResponse'),
          },
        },
      },
    },
    '/api/loos': {
      get: {
        tags: ['Loos'],
        summary: 'Fetch loos by ID',
        parameters: [
          {
            name: 'ids',
            in: 'query',
            required: true,
            description:
              'Comma separated IDs (?ids=a,b) or repeat the parameter (?ids=a&ids=b).',
            schema: {
              oneOf: [
                {
                  type: 'string',
                  pattern: `^([a-f0-9]{${LOO_ID_LENGTH}})(,[a-f0-9]{${LOO_ID_LENGTH}})*$`,
                  example: '0123456789abcdef01234567,89abcdef0123456701234567',
                },
                {
                  type: 'array',
                  items: {
                    type: 'string',
                    minLength: LOO_ID_LENGTH,
                    maxLength: LOO_ID_LENGTH,
                    pattern: '^[a-f0-9]{24}$',
                  },
                  example: [
                    '0123456789abcdef01234567',
                    '89abcdef0123456701234567',
                  ],
                },
              ],
            },
            style: 'form',
            explode: true,
          },
        ],
        responses: {
          200: {
            description: 'Matching loos.',
            content: jsonContent('LooListResponse'),
          },
          400: {
            description: 'Missing or invalid query parameters.',
            content: jsonContent('ValidationErrorResponse'),
          },
        },
      },
      post: {
        tags: ['Loos'],
        summary: 'Create a loo',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          description: 'Attributes to set for the new loo.',
          content: jsonContent('CreateLooRequest'),
        },
        responses: {
          201: {
            description: 'Loo created.',
            content: jsonContent('Loo'),
          },
          400: {
            description: 'Invalid request payload.',
            content: jsonContent('ValidationErrorResponse'),
          },
          401: authErrorResponse,
          409: {
            description: 'A loo with the supplied ID already exists.',
            content: jsonContent('ErrorResponse'),
          },
        },
      },
    },
    '/api/loos/{id}': {
      get: {
        tags: ['Loos'],
        summary: 'Fetch a single loo',
        parameters: [idPathParameter],
        responses: {
          200: {
            description: 'Loo detail.',
            content: jsonContent('Loo'),
          },
          400: {
            description: 'Invalid loo identifier.',
            content: jsonContent('ValidationErrorResponse'),
          },
          404: {
            description: 'Loo not found.',
            content: jsonContent('ErrorResponse'),
          },
        },
      },
      put: {
        tags: ['Loos'],
        summary: 'Create or replace a loo',
        parameters: [idPathParameter],
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          description: 'Attributes to upsert.',
          content: jsonContent('UpdateLooRequest'),
        },
        responses: {
          200: {
            description: 'Existing loo updated.',
            content: jsonContent('Loo'),
          },
          201: {
            description: 'New loo created.',
            content: jsonContent('Loo'),
          },
          400: {
            description: 'Invalid identifier or payload.',
            content: jsonContent('ValidationErrorResponse'),
          },
          401: authErrorResponse,
        },
      },
    },
    '/api/loos/{id}/reports': {
      get: {
        tags: ['Loos'],
        summary: 'List reports for a loo',
        description:
          'Contributor identifiers are redacted unless the caller includes an Auth0 admin bearer token.',
        parameters: [
          idPathParameter,
          {
            name: 'hydrate',
            in: 'query',
            required: false,
            description:
              'Set to true to include full report snapshots instead of diffs.',
            schema: { type: 'boolean', default: false },
          },
        ],
        responses: {
          200: {
            description:
              'Reports associated with the loo. Returns diffs by default; full records when hydrate=true.',
            content: jsonContent('ReportListResponse'),
          },
          400: {
            description: 'Invalid loo identifier.',
            content: jsonContent('ValidationErrorResponse'),
          },
          401: {
            description:
              'Invalid authentication (Bearer token or session cookie). This endpoint is otherwise public.',
            content: jsonContent('ErrorResponse'),
          },
        },
      },
    },
    '/api/loos/geohash/{geohash}': {
      get: {
        tags: ['Loos'],
        summary: 'List loos by geohash prefix',
        parameters: [
          {
            name: 'geohash',
            in: 'path',
            required: true,
            description: 'Geohash prefix to match.',
            schema: { type: 'string', minLength: 1, example: 'gcpvj' },
          },
          {
            name: 'active',
            in: 'query',
            required: false,
            description:
              'Filter loos by activity status. Use `any` to disable the filter.',
            schema: {
              type: 'string',
              enum: ['true', 'false', 'any', 'all'],
            },
          },
          {
            name: 'compressed',
            in: 'query',
            required: false,
            description:
              'Return compressed data optimized for map rendering. If true, returns CompressedLoo objects.',
            schema: {
              type: 'boolean',
              default: false,
            },
          },
        ],
        responses: {
          200: {
            description: 'Loos matching the supplied geohash prefix.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    schemaRef('LooListResponse'),
                    schemaRef('CompressedLooListResponse'),
                  ],
                },
              },
            },
          },
        },
      },
    },
    '/api/loos/proximity': {
      get: {
        tags: ['Loos'],
        summary: 'Find loos near a location',
        parameters: [
          {
            name: 'lat',
            in: 'query',
            required: true,
            description: 'Latitude in decimal degrees.',
            schema: {
              type: 'number',
              minimum: -90,
              maximum: 90,
              example: 51.5074,
            },
          },
          {
            name: 'lng',
            in: 'query',
            required: true,
            description: 'Longitude in decimal degrees.',
            schema: {
              type: 'number',
              minimum: -180,
              maximum: 180,
              example: -0.1278,
            },
          },
          {
            name: 'radius',
            in: 'query',
            required: false,
            description: 'Search radius in meters (default 1000).',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 50000,
              default: 1000,
            },
          },
        ],
        responses: {
          200: {
            description:
              'Loos ordered by distance from the supplied coordinates.',
            content: jsonContent('NearbyLooListResponse'),
          },
          400: {
            description: 'Invalid query parameters.',
            content: jsonContent('ValidationErrorResponse'),
          },
        },
      },
    },
    '/api/loos/search': {
      get: {
        tags: ['Loos'],
        summary: 'Search loos with filters',
        parameters: searchFilterParameters,
        responses: {
          200: {
            description: 'Paged search results.',
            content: jsonContent('LooSearchResponse'),
          },
          400: {
            description: 'Invalid query parameters.',
            content: jsonContent('ValidationErrorResponse'),
          },
        },
      },
    },
    '/api/loos/metrics': {
      get: {
        tags: ['Loos'],
        summary: 'Retrieve aggregate metrics for filtered loos',
        description:
          'Returns counts and top-area information for the same query parameters accepted by `/api/loos/search`.',
        parameters: [
          ...searchFilterParameters,
          {
            name: 'recentWindowDays',
            in: 'query' as const,
            required: false,
            description:
              'Overrides the number of days considered when calculating the "recent" total (default 30, max 365).',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 365,
              default: RECENT_WINDOW_DAYS,
            },
          },
        ],
        responses: {
          200: {
            description: 'Aggregated metrics for the supplied filters.',
            content: jsonContent('LooMetricsResponse'),
          },
          400: {
            description: 'Invalid query parameters.',
            content: jsonContent('ValidationErrorResponse'),
          },
        },
      },
    },
  },
};
