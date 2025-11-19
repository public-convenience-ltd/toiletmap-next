import { z } from 'zod';
import { booleanFilterSchema } from '../../common/schemas';

export const mapDataSchema = z.object({
  active: booleanFilterSchema,
  accessible: booleanFilterSchema,
});

export const suspiciousActivitySchema = z.object({
  hoursWindow: z.coerce.number().int().positive().default(24),
  minRapidUpdates: z.coerce.number().int().positive().default(5),
  minLocationChangeMeters: z.coerce.number().int().positive().default(1000),
  minMassDeactivations: z.coerce.number().int().positive().default(5),
});
