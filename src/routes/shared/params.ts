import { LOO_ID_LENGTH } from '../../services/loo';

export const requireIdParam = (id: string | undefined | null) => {
  if (!id)
    return { ok: false as const, error: 'id path parameter is required' };
  if (id.length !== LOO_ID_LENGTH) {
    return {
      ok: false as const,
      error: `id must be exactly ${LOO_ID_LENGTH} characters`,
    };
  }
  return { ok: true as const, id };
};
