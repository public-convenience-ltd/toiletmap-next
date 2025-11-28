export const ADMIN_PERMISSION = 'access:admin';
export const REPORT_LOO_PERMISSION = 'report:loo';

export const KNOWN_PERMISSIONS = [
  ADMIN_PERMISSION,
  REPORT_LOO_PERMISSION,
] as const;

export type KnownPermission = (typeof KNOWN_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<KnownPermission, string> = {
  [ADMIN_PERMISSION]: 'Admin access',
  [REPORT_LOO_PERMISSION]: 'Loo contributions',
};

export const permissionDescription: Record<KnownPermission, string> = {
  [ADMIN_PERMISSION]: 'Allows the user to access the admin dashboard and dataset tools.',
  [REPORT_LOO_PERMISSION]: 'Allows the user to add or update loos via the API and admin tools.',
};
