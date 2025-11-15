import { prisma } from '../context';
import { issueTestToken, type IssueTokenOverrides } from '../utils/auth';

export const jsonHeaders = {
  'content-type': 'application/json',
} as const;

export const authedJsonHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
});

export const SEED_CONTRIBUTORS = {
  import: 'Seed Data Import',
  maintenance: 'Seed Data Maintenance',
  maintenanceFollowUp: 'Seed Data Maintenance Follow-up',
  propertyUpdate: 'Seed Data Property Update',
  survey: 'Seed Data Survey',
  seasonalReview: 'Seed Data Seasonal Review',
  retailAudit: 'Seed Data Retail Audit',
  retailRefresh: 'Seed Data Retail Refresh',
  accessibilityReview: 'Seed Data Accessibility Review',
  surveyEast: 'Seed Data Survey East',
  accessNotice: 'Seed Data Access Notice',
  accessRestored: 'Seed Data Access Restored',
  amenitiesReview: 'Seed Data Amenities Review',
  hoursUpdate: 'Seed Data Hours Update',
  stationReview: 'Seed Data Station Review',
  kioskVisit: 'Seed Data Kiosk Visit',
  kioskRemoval: 'Seed Data Kiosk Removal',
} as const;

export const REPORT_EXPECTATIONS = {
  property: {
    contributor: SEED_CONTRIBUTORS.propertyUpdate,
    notes: 'Seasonal hours updated after inspection',
    openingTimes: [
      ['10:00', '18:00'], // Monday
      [],                 // Tuesday (closed/unknown)
      [],                 // Wednesday (closed/unknown)
      [],                 // Thursday (closed/unknown)
      [],                 // Friday (closed/unknown)
      [],                 // Saturday (closed/unknown)
      [],                 // Sunday (closed/unknown)
    ],
  },
  seasonal: {
    contributor: SEED_CONTRIBUTORS.seasonalReview,
    notes: 'Seasonal hours restored for spring visitors',
    openingTimes: [
      ['09:00', '19:00'], // Monday
      ['09:00', '19:00'], // Tuesday
      ['09:00', '19:00'], // Wednesday
      ['09:00', '19:00'], // Thursday
      ['09:00', '21:00'], // Friday
      [],                 // Saturday (closed/unknown)
      [],                 // Sunday (closed/unknown)
    ],
  },
  system: {
    contributor: SEED_CONTRIBUTORS.survey,
    notes: 'Seasonal hours updated after inspection',
    location: { lat: 55.951, lng: -3.2012 },
  },
} as const;

export type SeedReportExpectation = {
  contributor: string;
  notes?: string;
  openingTimes?: unknown;
  isSystemReport?: boolean;
  location?: { lat: number; lng: number } | null;
};

export type SeedFixtures = {
  listing: { ids: string[]; detailId: string };
  reports: { id: string; expectations: SeedReportExpectation[] };
  geohash: {
    prefix: string;
    inactive: { id: string; geohash: string } | null;
    allInactive: Array<{ id: string; geohash: string }>;
  };
  proximity: { id: string; lat: number; lng: number };
  areaId: string | null;
};

export const loadLooSeedData = async (): Promise<SeedFixtures> => {
  const seeded = await prisma.toilets.findMany({
    where: { contributors: { has: SEED_CONTRIBUTORS.import } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true, geohash: true },
    take: 8,
  });

  if (seeded.length < 3) {
    throw new Error(
      'Seed data should contain at least three toilets for e2e tests',
    );
  }

  const surveyed = await prisma.toilets.findFirst({
    where: { contributors: { has: SEED_CONTRIBUTORS.survey } },
    select: { id: true, geohash: true, area_id: true },
  });

  if (!surveyed) {
    throw new Error('Seed data should include a surveyed toilet with history');
  }

  const listingIds = Array.from(
    new Set([surveyed.id, ...seeded.map((loo) => loo.id)]),
  ).slice(0, 3);

  const geohashSource =
    surveyed.geohash ??
    seeded.find((loo) => loo.geohash)?.geohash ??
    (
      await prisma.toilets.findFirst({
        where: { geohash: { not: null } },
        select: { geohash: true },
      })
    )?.geohash ??
    '';

  if (!geohashSource) {
    throw new Error('Seed data should include at least one geohash');
  }

  const geohashPrefix = geohashSource.slice(0, 6);

  const inactive = await prisma.toilets.findMany({
    where: { active: false, geohash: { not: null } },
    select: { id: true, geohash: true },
    orderBy: { id: 'asc' },
  });

  const proximityRows = await prisma.$queryRaw<
    Array<{ id: string; lat: number; lng: number }>
  >`SELECT id, ST_Y(geography::geometry) AS lat, ST_X(geography::geometry) AS lng
      FROM toilets
      WHERE geography IS NOT NULL
      LIMIT 1`;

  if (!proximityRows.length) {
    throw new Error('Seed data should include at least one geocoded toilet');
  }

  const areaId =
    surveyed.area_id ??
    (
      await prisma.areas.findFirst({
        select: { id: true },
      })
    )?.id ??
    null;

  const reportExpectations: SeedReportExpectation[] = [
    {
      contributor: REPORT_EXPECTATIONS.property.contributor,
      notes: REPORT_EXPECTATIONS.property.notes,
      openingTimes: REPORT_EXPECTATIONS.property.openingTimes,
    },
    {
      contributor: REPORT_EXPECTATIONS.seasonal.contributor,
      notes: REPORT_EXPECTATIONS.seasonal.notes,
      openingTimes: REPORT_EXPECTATIONS.seasonal.openingTimes,
    },
    {
      contributor: REPORT_EXPECTATIONS.system.contributor,
      notes: REPORT_EXPECTATIONS.system.notes,
      location: REPORT_EXPECTATIONS.system.location,
      isSystemReport: true,
    },
  ];

  return {
    listing: { ids: listingIds, detailId: surveyed.id },
    reports: { id: surveyed.id, expectations: reportExpectations },
    geohash: {
      prefix: geohashPrefix,
      inactive: inactive[0] ?? null,
      allInactive: inactive,
    },
    proximity: proximityRows[0],
    areaId,
  };
};

export const deleteTestLoos = async (ids: string[]) => {
  if (!ids.length) return;
  await prisma.toilets.deleteMany({
    where: { id: { in: ids } },
  });
};

export const issueAuthToken = (overrides?: IssueTokenOverrides) =>
  issueTestToken(overrides);
