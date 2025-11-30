/**
 * Type definitions for Loos List client components
 */

export type SortOrder = "asc" | "desc";

export type FilterMappings = Record<string, { param: string; mapping?: Record<string, string> }>;

export type ScriptState = {
  search: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: SortOrder;
  hasCustomSort: boolean;
  filters: Record<string, string>;
};

export type SearchResponse = {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type MetricsResponse = {
  totals?: Record<string, number>;
  areas?: Array<{ name: string | null; count: number }>;
};

export type PageConfig = {
  query?: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: SortOrder;
    hasCustomSort?: boolean;
    filters?: Record<string, string>;
  };
  filterMappings?: FilterMappings;
  areaColors?: string[];
  recentWindowDays?: number;
  currentPath?: string;
  api?: {
    search?: string;
    metrics?: string;
  };
};

export type LooRecord = {
  id: string;
  name: string;
  area?: Array<{ name: string }>;
  geohash?: string;
  active?: boolean;
  verified_at?: string;
  verifiedAt?: string;
  accessible?: boolean;
  baby_change?: boolean;
  babyChange?: boolean;
  no_payment?: boolean;
  noPayment?: boolean;
  radar?: boolean;
  updated_at?: string;
  updatedAt?: string;
  created_at?: string;
  createdAt?: string;
  contributorsCount?: number;
  contributors_count?: number;
  openingTimes?: unknown;
  opening_times?: unknown;
};
