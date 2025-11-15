import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOO_ID_LENGTH, generateLooId } from '../../../src/services/loo';
import { prisma, testClient } from '../context';
import {
  authedJsonHeaders,
  deleteTestLoos,
  issueAuthToken,
  loadLooSeedData,
} from './helpers';

/** Ensures every mutation path emits consistent audit history. */
type ReportSummaryRow = {
  id: string;
  contributor: string;
  createdAt: string;
  isSystemReport: boolean;
  diff: Record<string, { previous: unknown; current: unknown }> | null;
};

type HydratedReportRow = ReportSummaryRow & {
  notes: string | null;
  openingTimes: unknown;
  location: { lat: number; lng: number } | null;
  accessible: boolean | null;
  [key: string]: unknown;
};

type ReportSummaryResponse = {
  data: Array<ReportSummaryRow>;
  count: number;
};

describe.sequential('Loos API - audit history', () => {
  let authToken: string;
  let createdIds: string[] = [];
  let areaId: string | null = null;

  beforeAll(async () => {
    authToken = issueAuthToken();
    const seed = await loadLooSeedData();
    areaId = seed.areaId;
  });

  afterAll(async () => {
    await deleteTestLoos(createdIds);
  });

  it('records audit history for property and location changes', async () => {
    const createPayload = {
      id: generateLooId(),
      name: 'Audit Trail Loo',
      areaId,
      accessible: true,
      notes: 'Initial audit trail test',
      openingTimes: { monday: ['09:00-17:00'] },
      location: { lat: 51.498, lng: -0.128 },
    };

    const createResult = await testClient.json<{
      id: string;
      reports: unknown[];
    }>('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(createPayload),
    });

    expect(createResult.response.status).toBe(201);
    expect(createResult.data.id).toHaveLength(LOO_ID_LENGTH);
    expect(createResult.data.reports).toEqual([]);

    const id = createResult.data.id;
    createdIds.push(id);

    const propertyUpdatePayload = {
      accessible: false,
      notes: 'Accessibility temporarily reduced',
      openingTimes: {
        monday: ['10:00-16:00'],
        tuesday: ['10:00-16:00'],
      },
    };

    const propertyUpdate = await testClient.json(`/loos/${id}`, {
      method: 'PUT',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(propertyUpdatePayload),
    });

    expect(propertyUpdate.response.status).toBe(200);

    const locationUpdatePayload = {
      location: { lat: 51.4995, lng: -0.1357 },
    };

    const locationUpdate = await testClient.json(`/loos/${id}`, {
      method: 'PUT',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(locationUpdatePayload),
    });

    expect(locationUpdate.response.status).toBe(200);

    const auditResponse = await testClient.json<ReportSummaryResponse>(
      `/loos/${id}/reports`,
    );

    expect(auditResponse.response.status).toBe(200);
    expect(auditResponse.data.count).toBe(auditResponse.data.data.length);
    expect(auditResponse.data.data.length).toBeGreaterThanOrEqual(3);

    const reports = auditResponse.data.data;
    const locationReport = reports.find((entry) => entry.isSystemReport);
    expect(locationReport).toBeDefined();
    expect(locationReport?.contributor).toBe('E2E Tester');
    expect(locationReport?.diff).not.toBeNull();
    expect(locationReport?.diff?.location?.current).toEqual(
      locationUpdatePayload.location,
    );
    if (locationReport) {
      expect(
        Object.prototype.hasOwnProperty.call(locationReport, 'location'),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(locationReport, 'notes'),
      ).toBe(false);
    }

    const propertyReport = reports.find(
      (entry) =>
        !entry.isSystemReport &&
        entry.diff?.notes?.current === propertyUpdatePayload.notes,
    );
    expect(propertyReport).toBeDefined();
    expect(propertyReport?.diff).not.toBeNull();
    expect(propertyReport?.diff?.accessible?.current).toBe(false);
    expect(propertyReport?.diff?.accessible?.previous).toBe(true);
    expect(propertyReport?.diff?.notes?.current).toBe(
      propertyUpdatePayload.notes,
    );
    expect(propertyReport?.diff?.notes?.previous).toBe(
      createPayload.notes,
    );
    expect(propertyReport?.diff?.openingTimes?.current).toEqual(
      propertyUpdatePayload.openingTimes,
    );

    if (locationReport && propertyReport) {
      expect(
        new Date(locationReport.createdAt).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(propertyReport.createdAt).getTime(),
      );
    }

    const creationReport = reports.find(
      (entry) => !entry.isSystemReport && entry.diff === null,
    );
    expect(creationReport).toBeDefined();
    expect(creationReport?.diff).toBeNull();
    if (creationReport) {
      expect(
        Object.prototype.hasOwnProperty.call(creationReport, 'notes'),
      ).toBe(false);
    }

    const timestamps = reports.map((entry) =>
      new Date(entry.createdAt).getTime(),
    );
    expect(timestamps.every((value) => Number.isFinite(value))).toBe(true);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));

    const hydratedResponse = await testClient.json<{
      data: Array<HydratedReportRow>;
      count: number;
    }>(`/loos/${id}/reports?hydrate=true`);

    expect(hydratedResponse.response.status).toBe(200);
    expect(hydratedResponse.data.count).toBe(
      hydratedResponse.data.data.length,
    );

    const hydratedReports = hydratedResponse.data.data;
    const hydratedLocationReport = hydratedReports.find(
      (entry) => entry.isSystemReport,
    );
    expect(hydratedLocationReport).toBeDefined();
    expect(hydratedLocationReport?.location).toEqual(
      locationUpdatePayload.location,
    );
    expect(hydratedLocationReport?.notes).toBe(
      propertyUpdatePayload.notes,
    );

    const hydratedPropertyReport = hydratedReports.find(
      (entry) =>
        !entry.isSystemReport &&
        entry.notes === propertyUpdatePayload.notes,
    );
    expect(hydratedPropertyReport).toBeDefined();
    expect(hydratedPropertyReport?.openingTimes).toEqual(
      propertyUpdatePayload.openingTimes,
    );
    expect(hydratedPropertyReport?.accessible).toBe(false);

    const hydratedCreationReport = hydratedReports.find(
      (entry) =>
        !entry.isSystemReport && entry.notes === createPayload.notes,
    );
    expect(hydratedCreationReport).toBeDefined();
    expect(hydratedCreationReport?.diff).toBeNull();

    const saved = await prisma.toilets.findUnique({
      where: { id },
      select: { contributors: true },
    });
    const contributors = saved?.contributors ?? [];
    expect(contributors[contributors.length - 1]).toBe('E2E Tester');

    const legacyToken = issueAuthToken({
      nickname: 'E2E Tester-location',
      name: 'E2E Tester-location',
    });
    const legacyUpdate = await testClient.json(`/loos/${id}`, {
      method: 'PUT',
      headers: authedJsonHeaders(legacyToken),
      body: JSON.stringify({
        notes: 'Legacy location audit entry',
      }),
    });
    expect(legacyUpdate.response.status).toBe(200);

    const filteredResponse = await testClient.json<ReportSummaryResponse>(
      `/loos/${id}/reports`,
    );
    expect(filteredResponse.response.status).toBe(200);
    expect(
      filteredResponse.data.data.some((entry) =>
        entry.contributor.endsWith('-location'),
      ),
    ).toBe(false);
  });
});
