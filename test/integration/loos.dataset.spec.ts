import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baseMutationSchema } from '../../src/routes/loos/schemas';
import { callApi, jsonRequest } from './utils/test-client';
import { legacyRecordToMutation, type LegacyToiletRecord } from './utils/legacy-records';
import { getTestContext } from './setup';

const datasetPath = new URL('../../toilets-2025-11-04.json', import.meta.url);
const toiletsDataset = JSON.parse(
  readFileSync(datasetPath, 'utf-8'),
) as LegacyToiletRecord[];

describe('Legacy dataset upsert coverage', () => {
  it(
    'successfully parses the entire dataset with the Zod mutation schema',
    () => {
      const failures: Array<{ id: string; issue: string }> = [];
      for (const record of toiletsDataset) {
        const payload = legacyRecordToMutation(record);
        const parsed = baseMutationSchema.safeParse(payload);
        if (!parsed.success) {
          failures.push({
            id: record.id,
            issue: parsed.error.message,
          });
        }
      }
      expect(failures).toEqual([]);
    },
    60_000,
  );

  it(
    'upserts representative records via the API without validation errors',
    async () => {
      const sampleIndexes = [
        0,
        Math.floor(toiletsDataset.length / 2),
        toiletsDataset.length - 1,
      ];
      const { issueToken, prisma } = getTestContext();
      const token = issueToken();

      for (const index of sampleIndexes) {
        const record = toiletsDataset[index];
        const payload = legacyRecordToMutation(record);

        if (payload.areaId) {
          try {
            await prisma.areas.upsert({
              where: { id: payload.areaId },
              update: {},
              create: {
                id: payload.areaId,
                name: `${payload.areaId}-integration`,
                type: record.areas?.type ?? 'legacy',
                dataset_id: 99,
                version: 1,
                priority: index + 1,
              },
            });
          } catch (error) {
            if (
              error instanceof Error &&
              /permission denied/i.test(error.message)
            ) {
              payload.areaId = null;
            } else {
              throw error;
            }
          }
        }

        const response = await callApi(
          `/loos/${record.id}`,
          jsonRequest('PUT', payload, { Authorization: `Bearer ${token}` }),
        );
        expect([200, 201]).toContain(response.status);
      }
    },
    90_000,
  );
});
