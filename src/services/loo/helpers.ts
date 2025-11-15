import { Auth0User } from '../../types';

export const parseActiveFlag = (value: string | undefined | null) => {
  if (value === null || value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'any' || normalized === 'all') return null;
  return true;
};

export const extractContributor = (user: Auth0User | undefined | null) => {
  if (!user) return null;
  const profileKey = process.env.AUTH0_PROFILE_KEY;
  if (
    profileKey &&
    (user as any)[profileKey] &&
    typeof (user as any)[profileKey] === 'object'
  ) {
    const profile = (user as any)[profileKey] as { nickname?: string | null };
    if (typeof profile.nickname === 'string' && profile.nickname.trim()) {
      return profile.nickname.trim();
    }
  }
  if (
    typeof (user as any).nickname === 'string' &&
    (user as any).nickname.trim()
  ) {
    return (user as any).nickname.trim();
  }
  if (typeof (user as any).name === 'string' && (user as any).name.trim()) {
    return (user as any).name.trim();
  }
  if (typeof (user as any).sub === 'string' && (user as any).sub.trim()) {
    return (user as any).sub.trim();
  }
  return null;
};
