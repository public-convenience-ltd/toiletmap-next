import type { ReportResponse } from '../loo/types';

export type ContributorSuggestion = {
  handle: string;
  contributions: number;
};

type ContributorSummary = {
  handle: string;
  totalLoos: number;
  activeLoos: number;
  verifiedLoos: number;
  recentLoos: number;
  totalEvents: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type ContributorAreaStat = {
  areaId: string | null;
  name: string | null;
  count: number;
};

type ContributorLoo = {
  id: string;
  name: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
  areaName: string | null;
  areaType: string | null;
};

export type ContributorReport = ReportResponse & {
  looId: string | null;
  looName: string | null;
  occurredAt: string;
};

export type ContributorStats = {
  summary: ContributorSummary;
  areas: ContributorAreaStat[];
  loos: ContributorLoo[];
  recentReports: ContributorReport[];
};
