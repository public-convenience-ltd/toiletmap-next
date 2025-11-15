import type {
  MediaTypeObject,
  OpenAPIObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

const LOO_ID_LENGTH = 24;

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
    required: ['status', 'service', 'uptime'],
    properties: {
      status: { type: 'string', enum: ['ok'] },
      service: { type: 'string', example: 'toiletmap-hono-api' },
      uptime: { type: 'number', example: 42.17 },
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
    required: ['id', 'contributor', 'createdAt', 'isSystemReport', 'diff'],
    properties: {
      id: { type: 'string', example: '9234' },
      contributor: { type: 'string', example: 'jane.doe' },
      createdAt: { type: 'string', format: 'date-time' },
      isSystemReport: { type: 'boolean' },
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
        anyOf: [schemaRef('JsonValue'), { type: 'null' }],
        description: 'Arbitrary JSON payload describing opening times.',
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
    required: ['id', 'area', 'reports'],
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
        anyOf: [schemaRef('JsonValue'), { type: 'null' }],
        description: 'Opening hours metadata if known.',
      },
      reports: {
        type: 'array',
        description: 'Recent reports are populated on specific endpoints.',
        items: {},
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
    required: ['id', 'contributor', 'createdAt', 'isSystemReport', 'diff'],
    properties: {
      id: { type: 'string', example: '9234' },
      contributor: { type: 'string', example: 'jane.doe' },
      createdAt: { type: 'string', format: 'date-time' },
      verifiedAt: nullableDateTime,
      isSystemReport: { type: 'boolean' },
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
        anyOf: [schemaRef('JsonValue'), { type: 'null' }],
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
          'Summary report entries. Pass hydrate=true to receive full Report objects.',
        items: schemaRef('ReportSummary'),
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
  description: 'Authentication required.',
  content: jsonContent('ErrorResponse'),
};

const triStateFilterSchema = {
  type: 'string',
  enum: ['any', 'true', 'false', 'null'],
  default: 'any',
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

export const openApiDocument: OpenAPIObject = {
  openapi: '3.1.0',
  info: {
    title: 'Toilet Map API',
    version: '1.0.0',
    description:
      'Programmatic access to Toilet Map loos and administrative areas.',
  },
  servers: [{ url: 'http://localhost:4001', description: 'Local development' }],
  tags: [
    { name: 'Meta', description: 'General service endpoints.' },
    { name: 'Areas', description: 'Administrative area operations.' },
    { name: 'Loos', description: 'Operations relating to loos.' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
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
    '/areas': {
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
    '/loos': {
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
        security: [{ bearerAuth: [] }],
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
    '/loos/{id}': {
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
        security: [{ bearerAuth: [] }],
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
      delete: {
        tags: ['Loos'],
        summary: 'Delete a loo',
        parameters: [idPathParameter],
        security: [{ bearerAuth: [] }],
        responses: {
          204: { description: 'Loo deleted.' },
          400: {
            description: 'Invalid loo identifier.',
            content: jsonContent('ValidationErrorResponse'),
          },
          401: authErrorResponse,
          404: {
            description: 'Loo not found.',
            content: jsonContent('ErrorResponse'),
          },
        },
      },
    },
  '/loos/{id}/reports': {
    get: {
      tags: ['Loos'],
      summary: 'List reports for a loo',
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
        },
      },
    },
    '/loos/geohash/{geohash}': {
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
        ],
        responses: {
          200: {
            description: 'Loos matching the supplied geohash prefix.',
            content: jsonContent('LooListResponse'),
          },
        },
      },
    },
    '/loos/proximity': {
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
    '/loos/search': {
      get: {
        tags: ['Loos'],
        summary: 'Search loos with filters',
        parameters: [
          {
            name: 'search',
            in: 'query' as const,
            required: false,
            description:
              'Keyword search across id, name, geohash, and notes.',
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
              'Active status. Use `any` to include all values or `null` for unknown.',
            schema: triStateFilterSchema,
          },
          {
            name: 'accessible',
            in: 'query' as const,
            required: false,
            description:
              'Accessible flag. Use `any` to include all values or `null` for unknown.',
            schema: triStateFilterSchema,
          },
          {
            name: 'allGender',
            in: 'query' as const,
            required: false,
            description:
              'All gender flag. Use `any` to include all values or `null` for unknown.',
            schema: triStateFilterSchema,
          },
          {
            name: 'radar',
            in: 'query' as const,
            required: false,
            description:
              'RADAR key availability. Use `any` to include all values or `null` for unknown.',
            schema: triStateFilterSchema,
          },
          {
            name: 'babyChange',
            in: 'query' as const,
            required: false,
            description:
              'Baby change facilities. Use `any` to include all values or `null` for unknown.',
            schema: triStateFilterSchema,
          },
          {
            name: 'noPayment',
            in: 'query' as const,
            required: false,
            description:
              'Whether payment is required. Use `any` to include all values or `null` for unknown.',
            schema: triStateFilterSchema,
          },
          {
            name: 'verified',
            in: 'query' as const,
            required: false,
            description:
              'Verification status. Use `any` to include all values.',
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
        ],
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
  },
};

export type OpenApiDocument = typeof openApiDocument;
