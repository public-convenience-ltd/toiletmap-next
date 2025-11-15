import { describe, expect, it } from 'vitest';
import { prisma, testClient } from './context';

/** Validates that the areas listing stays in sync with the backing table. */
type Area = {
  name: string | null;
  type: string | null;
};

type AreasResponse = {
  data: Area[];
  count: number;
};

describe('Areas API', () => {
  it('returns all administrative areas with count metadata', async () => {
    const { response, data } =
      await testClient.json<AreasResponse>('/areas');

    expect(response.status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.count).toBe(data.data.length);
    expect(data.count).toBeGreaterThan(0);

    const dbCount = await prisma.areas.count();
    expect(data.count).toBe(dbCount);

    for (const area of data.data) {
      expect(area).toHaveProperty('name');
      expect(area).toHaveProperty('type');
    }
  });
});
