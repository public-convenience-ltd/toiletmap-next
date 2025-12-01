export type CompressedLooTuple = [string, string, number];

export type LooFeatureFlags = {
  accessible: boolean;
  babyChange: boolean;
  radar: boolean;
  automatic: boolean;
  allGender: boolean;
  noPayment: boolean;
};

export type ApiLooResponse = {
  id: string;
  geohash: string | null;
  location: { lat: number; lng: number } | null;
  name: string | null;
  area: Array<{ name: string | null; type: string | null }>;
  createdAt: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
  reports?: unknown[];
  contributorsCount?: number;
  notes: string | null;
  paymentDetails: string | null;
  openingTimes: unknown;
  removalReason: string | null;
  accessible: boolean | null;
  active: boolean | null;
  allGender: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  babyChange: boolean | null;
  children: boolean | null;
  men: boolean | null;
  women: boolean | null;
  urinalOnly: boolean | null;
  noPayment: boolean | null;
  radar: boolean | null;
  [key: string]: unknown;
};

export type MapLoo = {
  id: string;
  geohash: string;
  lat: number;
  lng: number;
  features: LooFeatureFlags;
  detailLevel: "compressed" | "full";
  full?: ApiLooResponse;
};

export type StatusState = {
  isLoading: boolean;
  looCount: number;
  tileCount: number;
  precision: number;
  error: string | null;
};

export interface LooMapProps {
  apiUrl: string;
}

export type FetchMetrics = {
  markersAdded: number;
  markersRemoved: number;
  totalMarkers: number;
  tilesRequested: number;
  cacheHits: number;
  fetchedTiles: number;
  fetchDurationMs: number;
};

export type CacheTreeStats = {
  nodeCount: number;
  leafCount: number;
  uniqueLoos: number;
  coverageNodes: number;
  freshCoverageNodes: number;
  fullCoverageNodes: number;
  hydratedLoos: number;
  maxDepth: number;
};
