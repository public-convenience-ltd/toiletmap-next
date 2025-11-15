import { beforeAll, describe, expect, it } from 'vitest';
import { LOO_ID_LENGTH } from '../../../src/services/loo';
import { testClient } from '../context';
import { REPORT_EXPECTATIONS, loadLooSeedData } from './helpers';

/** Exercises every read-only loo surface (lists, lookups, history). */
type ReportSummaryRow = {
  id: string;
  createdAt: string;
  contributor: string;
  isSystemReport: boolean;
  diff: Record<string, { previous: unknown; current: unknown }> | null;
};

type HydratedReportRow = ReportSummaryRow & {
  notes: unknown;
  openingTimes: unknown;
  location: { lat: number; lng: number } | null;
  [key: string]: unknown;
};

describe.sequential('Loos API - listing', () => {
  let seedData: Awaited<ReturnType<typeof loadLooSeedData>>;

  beforeAll(async () => {
    seedData = await loadLooSeedData();
  });

  it('rejects list requests without ids query parameter', async () => {
    const response = await testClient.fetch('/loos');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('message');
  });

  it('returns loos for the provided ids in order', async () => {
    const idsQuery = seedData.listing.ids
      .map((id) => `ids=${id}`)
      .join('&');

    const { response, data } = await testClient.json<{
      data: Array<{ id: string }>;
      count: number;
    }>(`/loos?${idsQuery}`);

    expect(response.status).toBe(200);
    expect(data.count).toBe(seedData.listing.ids.length);
    expect(data.data.map((loo) => loo.id)).toEqual(seedData.listing.ids);
  });

  it('returns loo details by id', async () => {
    const { response, data } = await testClient.json<{
      id: string;
      area: Array<{ name: string | null; type: string | null }>;
    }>(`/loos/${seedData.listing.detailId}`);

    expect(response.status).toBe(200);
    expect(data.id).toBe(seedData.listing.detailId);
    expect(Array.isArray(data.area)).toBe(true);
  });

  it('validates loo id length', async () => {
    const invalidId = 'x'.repeat(LOO_ID_LENGTH - 1);
    const response = await testClient.fetch(`/loos/${invalidId}`);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('id must be exactly');
  });

  it('lists loos by geohash prefix', async () => {
    const { response, data } =
      await testClient.json<{
        data: Array<{ geohash: string | null }>;
        count: number;
      }>(
        `/loos/geohash/${encodeURIComponent(seedData.geohash.prefix)}`,
      );

    expect(response.status).toBe(200);
    expect(data.count).toBe(data.data.length);
    for (const loo of data.data) {
      expect(loo.geohash?.startsWith(seedData.geohash.prefix)).toBe(true);
    }
  });

  it('respects active query flag when listing by geohash', async ({ skip }) => {
    if (!seedData.geohash.inactive) {
      skip();
    }

    expect(seedData.geohash.allInactive.length).toBeGreaterThanOrEqual(2);

    const { response, data } =
      await testClient.json<{
        data: Array<{ active: boolean | null }>;
        count: number;
      }>(
        `/loos/geohash/${encodeURIComponent(
          seedData.geohash.inactive!.geohash,
        )}?active=false`,
      );

    expect(response.status).toBe(200);
    expect(data.count).toBeGreaterThan(0);
    for (const loo of data.data) {
      expect(loo.active).toBe(false);
    }
  });

  it('rejects invalid proximity queries', async () => {
    const response = await testClient.fetch(
      '/loos/proximity?lat=91&lng=0&radius=100',
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBe('Invalid proximity query');
  });

  it('finds loos within a radius of a coordinate', async () => {
    const { response, data } =
      await testClient.json<{
        data: Array<{ id: string }>;
        count: number;
      }>(
        `/loos/proximity?lat=${seedData.proximity.lat}&lng=${seedData.proximity.lng}&radius=200`,
      );

    expect(response.status).toBe(200);
    expect(data.count).toBe(data.data.length);
    expect(
      data.data.some((loo) => loo.id === seedData.proximity.id),
    ).toBe(true);
  });

  it('returns seeded audit reports with property and system history', async () => {
    const { response, data } = await testClient.json<{
      data: Array<ReportSummaryRow>;
      count: number;
    }>(`/loos/${seedData.reports.id}/reports`);

    expect(response.status).toBe(200);
    expect(data.count).toBe(data.data.length);
    expect(data.data.length).toBeGreaterThanOrEqual(
      seedData.reports.expectations.length,
    );

    const reports = data.data;
    const timestamps = reports.map((report) =>
      new Date(report.createdAt).getTime(),
    );
    expect(timestamps.every((stamp) => Number.isFinite(stamp))).toBe(true);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);

    for (const expectation of seedData.reports.expectations) {
      const matching = reports.find(
        (report) => report.contributor === expectation.contributor,
      );

      expect(matching).toBeDefined();

      if (matching) {
        expect(matching.diff).not.toBeUndefined();
        if (expectation.notes !== undefined) {
          if (matching.diff?.notes) {
            expect(matching.diff.notes.current).toEqual(
              expectation.notes,
            );
          }
          expect(
            Object.prototype.hasOwnProperty.call(matching, 'notes'),
          ).toBe(false);
        }

        if (expectation.openingTimes !== undefined) {
          if (matching.diff?.openingTimes) {
            expect(matching.diff.openingTimes.current).toEqual(
              expectation.openingTimes,
            );
          }
          expect(
            Object.prototype.hasOwnProperty.call(matching, 'openingTimes'),
          ).toBe(false);
        }

        if (expectation.isSystemReport) {
          expect(matching.isSystemReport).toBe(true);
          expect(matching.diff?.location?.current).toEqual(
            expectation.location,
          );
          expect(
            Object.prototype.hasOwnProperty.call(matching, 'location'),
          ).toBe(false);
        }
      }
    }

    const contributors = new Set(
      reports.map((report) => report.contributor),
    );
    expect(
      contributors.has(REPORT_EXPECTATIONS.property.contributor),
    ).toBe(true);
    expect(
      contributors.has(REPORT_EXPECTATIONS.seasonal.contributor),
    ).toBe(true);
    expect(
      contributors.has(REPORT_EXPECTATIONS.system.contributor),
    ).toBe(true);

    const hydrated = await testClient.json<{
      data: Array<HydratedReportRow>;
      count: number;
    }>(`/loos/${seedData.reports.id}/reports?hydrate=true`);

    expect(hydrated.response.status).toBe(200);
    expect(hydrated.data.count).toBe(hydrated.data.data.length);
    expect(hydrated.data.data.length).toBeGreaterThanOrEqual(
      seedData.reports.expectations.length,
    );

    for (const expectation of seedData.reports.expectations) {
      const matching = hydrated.data.data.find(
        (report) => report.contributor === expectation.contributor,
      );

      expect(matching).toBeDefined();

      if (expectation.notes !== undefined) {
        expect(matching?.notes).toEqual(expectation.notes);
      }

      if (expectation.openingTimes !== undefined) {
        expect(matching?.openingTimes).toEqual(expectation.openingTimes);
      }

      if (expectation.isSystemReport) {
        expect(matching?.location).toEqual(expectation.location);
      }
    }
  });
});
