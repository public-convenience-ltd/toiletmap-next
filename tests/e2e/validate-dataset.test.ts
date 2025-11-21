import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { baseMutationSchema } from '../../src/routes/loos/schemas';
import { LooService } from '../../src/services/loo/loo.service';
import type { PrismaClientInstance } from '../../src/prisma';

// Mock persistence helpers to avoid actual DB calls
vi.mock('../../src/services/loo/persistence', () => ({
  insertLoo: vi.fn(),
  updateLoo: vi.fn().mockResolvedValue(1),
}));

describe('Dataset Validation', () => {
  it('should parse every loo from the dataset correctly', async () => {
    const datasetPath = path.join(__dirname, '../../toilets-2025-11-04.json');
    const fileContent = fs.readFileSync(datasetPath, 'utf-8');
    const loos = JSON.parse(fileContent);

    // Create a mock Prisma client object
    const mPrismaClient = {
      $transaction: vi.fn((callback) => callback(mPrismaClient)),
      toilets: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      record_version: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      $queryRaw: vi.fn(),
    } as unknown as PrismaClientInstance;

    const looService = new LooService(mPrismaClient);

    console.log(`Validating ${loos.length} loos...`);

    let validCount = 0;
    const errors: any[] = [];

    for (const loo of loos) {
      // Map dataset format to mutation format
      const mutationData = {
        name: loo.name,
        areaId: loo.area_id,
        accessible: loo.accessible,
        active: loo.active,
        allGender: loo.all_gender,
        attended: loo.attended,
        automatic: loo.automatic,
        babyChange: loo.baby_change,
        children: loo.children,
        men: loo.men,
        women: loo.women,
        urinalOnly: loo.urinal_only,
        radar: loo.radar,
        notes: loo.notes,
        noPayment: loo.no_payment,
        paymentDetails: loo.payment_details,
        removalReason: loo.removal_reason, // Might be missing in dataset, undefined is fine
        openingTimes: loo.opening_times,
        location: loo.location
          ? {
              lat: loo.location.coordinates[1],
              lng: loo.location.coordinates[0],
            }
          : null,
      };

      try {
        // 1. Validate against Schema
        const parsed = baseMutationSchema.parse(mutationData);

        // 2. Validate against Service (Upsert)
        // We use a dummy ID and contributor since we are testing the mutation payload
        await looService.upsert(loo.id || 'dummy-id', parsed, 'test-contributor');

        validCount++;
      } catch (error) {
        errors.push({
          id: loo.id,
          name: loo.name,
          value: mutationData, // Include the data being validated
          error: error instanceof Error ? error.message : error,
          zodError: error instanceof z.ZodError ? error.issues : undefined,
        });
      }
    }

    if (errors.length > 0) {
      console.error('Validation failed for the following loos:');
      // Print first 5 errors with full details
      errors.slice(0, 5).forEach((e) => {
        console.error(`Loo: ${e.name} (${e.id})`);
        if (e.zodError) {
          console.error('Validation Errors:', JSON.stringify(e.zodError, null, 2));
          // Try to pinpoint the value for the first error
          if (e.zodError.length > 0) {
             const path = e.zodError[0].path;
             let val: any = e.value;
             for (const p of path) {
               val = val?.[p];
             }
             console.error('Failing Value at path', path, ':', val);
          }
        } else {
          console.error('Error:', e.error);
        }
        console.error('--------------------------------');
      });
      if (errors.length > 5) {
        console.error(`...and ${errors.length - 5} more errors.`);
      }
    }

    expect(errors).toHaveLength(0);
    expect(validCount).toBe(loos.length);
  });
});
