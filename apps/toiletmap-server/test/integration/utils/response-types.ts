/**
 * JSON response shapes returned by the API, for use with `readJson<T>()`.
 * Entity types come from the service layer so tests track the real contract.
 */
import type {
  AdminGeo,
  CompressedLoo,
  LooMetricsResponse,
  LooResponse,
  NearbyLooResponse,
  ReportResponse,
  ReportSummaryResponse,
} from "../../../src/services/loo/types";

export type {
  CompressedLoo,
  LooMetricsResponse,
  LooResponse,
  NearbyLooResponse,
  ReportResponse,
  ReportSummaryResponse,
};

/** Body of 4xx/5xx responses. `issues` is the Zod `error.format()` tree on 400s. */
export type ErrorBody<Issues = unknown> = {
  message: string;
  error?: string;
  issues?: Issues;
};

/** One node of a Zod `error.format()` tree. */
export type FormattedFieldError = { _errors: string[] };

/** Envelope used by list endpoints: ids, dump, geohash, proximity, reports, areas. */
export type ListBody<T> = {
  data: T[];
  count: number;
};

export type SearchBody = ListBody<LooResponse> & {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type AreasBody = ListBody<AdminGeo>;

/** GET /api/loos/updates */
export type UpdatesBody = {
  upserted: CompressedLoo[];
  deleted: string[];
  /** Server sync cursor to send back as `since` next time. */
  cursor: string;
};

/** GET /api/loos/dump (compressed) */
export type DumpBody = ListBody<CompressedLoo> & { cursor: string };

/** 200/201 from an authenticated create or update. */
export type SavedLooBody = LooResponse & { compressed: CompressedLoo | null };

/** 409 from a report on a loo already off the map, or a restore of one on it. */
export type StateConflictBody = {
  message: string;
  error: "already_removed" | "not_removed";
  current: LooResponse;
};

/** 200 from POST /api/loos/:id/verify */
export type VerifyBody = { id: string; verifiedAt: string };

/** 202 from an anonymous create or update that was queued for moderation. */
export type QueuedBody = { queued: true; id: string };

/** 200 from an anonymous update that changed nothing. */
export type UnchangedBody = { queued: false; unchanged: true };

/** 409 from an update whose `baseUpdatedAt` no longer matches the record. */
export type ConflictBody = {
  message: string;
  error: "conflict";
  current: LooResponse;
};

export type HealthCheck = {
  name: string;
  status: "ok" | "error";
  message?: string;
  responseTime?: number;
};

/** GET /health/live */
export type LivenessBody = {
  status: "ok";
  service: string;
  timestamp: string;
};

/** GET /health/ready */
export type ReadinessBody = {
  status: "ok" | "degraded";
  service: string;
  timestamp: string;
  checks: HealthCheck[];
};

/** GET / */
export type ServiceInfoBody = {
  status: "ok" | "degraded";
  service: string;
  timestamp: string;
  user: {
    sub: string;
    name?: string;
    nickname?: string;
    email?: string;
    isAdmin: boolean;
  } | null;
  message: string;
};
