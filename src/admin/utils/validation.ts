import { z } from 'zod';
import { openingTimesSchema } from '../../common/schemas';

export const looSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    notes: z.string().optional(),
    accessible: z.enum(['true', 'false', '']).optional(),
    radar: z.enum(['true', 'false', '']).optional(),
    attended: z.enum(['true', 'false', '']).optional(),
    automatic: z.enum(['true', 'false', '']).optional(),
    noPayment: z.enum(['true', 'false', '']).optional(),
    paymentDetails: z.string().optional(),
    babyChange: z.enum(['true', 'false', '']).optional(),
    men: z.enum(['true', 'false', '']).optional(),
    women: z.enum(['true', 'false', '']).optional(),
    allGender: z.enum(['true', 'false', '']).optional(),
    children: z.enum(['true', 'false', '']).optional(),
    urinalOnly: z.enum(['true', 'false', '']).optional(),
    lat: z.coerce.number().min(-90).max(90, 'Invalid latitude'),
    lng: z.coerce.number().min(-180).max(180, 'Invalid longitude'),
    active: z.enum(['true', 'false', '']).optional(),
    removalReason: z.string().optional(),
    openingTimes: openingTimesSchema.optional(),
});

export type LooFormData = z.infer<typeof looSchema>;
