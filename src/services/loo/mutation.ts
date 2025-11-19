import { Prisma } from '../../generated/prisma-client';
import type { LooMutationAttributes } from './types';

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

export const mapMutationToPrismaData = (
  mutation: LooMutationAttributes,
  { forCreate }: { forCreate: boolean },
) => {
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
    // Preserve explicit null semantics on JSON
    data.opening_times = (mutation.openingTimes ?? null) as Prisma.InputJsonValue;
  }

  return data;
};
