import { Prisma } from '../../generated/prisma/client';
import type { LooMutationAttributes } from './types';
import { openingTimesSchema } from './types';

type MutationFieldMapEntry = {
  attr: keyof LooMutationAttributes;
  prismaKey: keyof Prisma.toiletsUncheckedCreateInput & string;
};

const MUTATION_PRISMA_FIELD_MAP = [
  { attr: 'name', prismaKey: 'name' },
  { attr: 'areaId', prismaKey: 'area_id' },
  { attr: 'accessible', prismaKey: 'accessible' },
  { attr: 'allGender', prismaKey: 'all_gender' },
  { attr: 'attended', prismaKey: 'attended' },
  { attr: 'automatic', prismaKey: 'automatic' },
  { attr: 'babyChange', prismaKey: 'baby_change' },
  { attr: 'children', prismaKey: 'children' },
  { attr: 'men', prismaKey: 'men' },
  { attr: 'women', prismaKey: 'women' },
  { attr: 'urinalOnly', prismaKey: 'urinal_only' },
  { attr: 'radar', prismaKey: 'radar' },
  { attr: 'notes', prismaKey: 'notes' },
  { attr: 'noPayment', prismaKey: 'no_payment' },
  { attr: 'paymentDetails', prismaKey: 'payment_details' },
  { attr: 'removalReason', prismaKey: 'removal_reason' },
] as const satisfies ReadonlyArray<MutationFieldMapEntry>;

type MutationPrismaKey = (typeof MUTATION_PRISMA_FIELD_MAP)[number]['prismaKey'];
type PrismaMutationData =
  Prisma.toiletsUncheckedCreateInput & Prisma.toiletsUncheckedUpdateInput;

// Overloaded signatures for type-safe returns
export function mapMutationToPrismaData(
  mutation: LooMutationAttributes,
  options: { forCreate: true },
): Prisma.toiletsUncheckedCreateInput;
export function mapMutationToPrismaData(
  mutation: LooMutationAttributes,
  options: { forCreate: false },
): Prisma.toiletsUncheckedUpdateInput;
export function mapMutationToPrismaData(
  mutation: LooMutationAttributes,
  { forCreate }: { forCreate: boolean },
): Prisma.toiletsUncheckedCreateInput | Prisma.toiletsUncheckedUpdateInput {
  const data: Partial<
    Record<MutationPrismaKey, PrismaMutationData[MutationPrismaKey]>
  > &
    Partial<Pick<PrismaMutationData, 'opening_times' | 'active'>> = {};

  const activeValue =
    mutation.active !== undefined
      ? mutation.active
      : forCreate
        ? true
        : undefined;
  if (activeValue !== undefined) data.active = activeValue;

  for (const { attr, prismaKey } of MUTATION_PRISMA_FIELD_MAP) {
    const value = mutation[attr];
    if (value !== undefined) {
      // normalise explicit nulls
      data[prismaKey] = value ?? null;
    }
  }

  if (mutation.openingTimes !== undefined) {
    // Preserve explicit null semantics on JSON, validate with schema
    const validated = openingTimesSchema.parse(mutation.openingTimes ?? null);
    data.opening_times = validated as Prisma.InputJsonValue;
  }

  // Type assertion: The built data object matches the expected Prisma input type
  // based on the forCreate parameter (enforced by overloaded signatures)
  return data as Prisma.toiletsUncheckedCreateInput | Prisma.toiletsUncheckedUpdateInput;
};
