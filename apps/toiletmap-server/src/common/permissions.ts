export const ADMIN_PERMISSION = "access:admin";

/**
 * Permissions the admin user page can grant or revoke. Editing loo data needs
 * no permission: anyone signed in writes directly unless they are blocked in
 * Auth0 (see `canWriteDirectly`).
 */
export const KNOWN_PERMISSIONS = [ADMIN_PERMISSION] as const;

export type KnownPermission = (typeof KNOWN_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<KnownPermission, string> = {
  [ADMIN_PERMISSION]: "Admin access",
};

export const permissionDescription: Record<KnownPermission, string> = {
  [ADMIN_PERMISSION]: "Allows the user to access the admin dashboard and dataset tools.",
};
