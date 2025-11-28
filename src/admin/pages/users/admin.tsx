import { Context } from "hono";
import { Layout } from "../../components/Layout";
import { Badge, Button, CollapsibleCard } from "../../components/DesignSystem";
import { AppVariables, Env } from "../../../types";
import {
  Auth0ManagementClient,
  Auth0ManagementError,
  Auth0ManagementUser,
  Auth0PermissionRecord,
} from "../../../services/auth0/management";
import {
  ADMIN_PERMISSION,
  KNOWN_PERMISSIONS,
  KnownPermission,
  PERMISSION_LABELS,
  permissionDescription,
  REPORT_LOO_PERMISSION,
} from "../../../common/permissions";
import { logger } from "../../../utils/logger";

type AdminContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const numberFormatter = new Intl.NumberFormat("en-GB");

const formatDate = (value?: string | null) =>
  value ? dateFormatter.format(new Date(value)) : "—";

const formatDateTime = (value?: string | null) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";

const formatPermissionLabel = (permission: string | null) => {
  if (!permission) return "Permission";
  if ((PERMISSION_LABELS as Record<string, string>)[permission]) {
    return PERMISSION_LABELS[permission as KnownPermission];
  }
  return permission;
};

const buildManageLink = (userId: string, searchTerm: string) => {
  const url = new URL("/admin/users/admin", "http://localhost");
  url.searchParams.set("user", userId);
  if (searchTerm) {
    url.searchParams.set("search", searchTerm);
  }
  return `${url.pathname}${url.search}`;
};

const summarizeUser = (user: Auth0ManagementUser | null): string => {
  if (!user) return "user";
  return user.name || user.nickname || user.email || user.user_id || "user";
};

const buildRedirectUrl = (input: string | null, fallbackUser?: string) => {
  try {
    if (input) {
      const candidate = new URL(input, "http://localhost");
      if (candidate.origin === "http://localhost") {
        return candidate;
      }
    }
  } catch {
    // Ignore invalid redirect target
  }
  const fallback = new URL("/admin/users/admin", "http://localhost");
  if (fallbackUser) {
    fallback.searchParams.set("user", fallbackUser);
  }
  return fallback;
};

const userPermissionOrder: KnownPermission[] = [
  ADMIN_PERMISSION,
  REPORT_LOO_PERMISSION,
];

export const userAdministration = async (c: AdminContext) => {
  const managementClient = Auth0ManagementClient.fromEnv(c.env);
  const searchTerm = (c.req.query("search") ?? "").trim();
  const selectedUserId = (c.req.query("user") ?? "").trim();
  const permissionStatus = (c.req.query("permissionStatus") ?? "").trim();
  const permissionCode = (c.req.query("permission") ?? "").trim();
  const permissionErrorMsg = (c.req.query("permissionError") ?? "").trim();

  const state: {
    managementConfigured: boolean;
    searchResults: Auth0ManagementUser[];
    searchError: string | null;
    selectedUser: Auth0ManagementUser | null;
    selectedUserPermissions: Auth0PermissionRecord[];
    selectedUserError: string | null;
  } = {
    managementConfigured: Boolean(managementClient),
    searchResults: [],
    searchError: null,
    selectedUser: null,
    selectedUserPermissions: [],
    selectedUserError: null,
  };

  if (managementClient && searchTerm) {
    try {
      state.searchResults = await managementClient.searchUsers(searchTerm, 6);
    } catch (error) {
      if (error instanceof Error) {
        logger.logError(error, { searchTerm });
      } else {
        logger.error('Failed to search Auth0 users in admin page', {
          searchTerm,
          errorMessage: String(error),
        });
      }
      state.searchError =
        error instanceof Auth0ManagementError
          ? error.message
          : "Unable to search Auth0 users.";
    }
  }

  if (managementClient && selectedUserId) {
    try {
      state.selectedUser = await managementClient.getUser(selectedUserId);
      if (!state.selectedUser) {
        state.selectedUserError = "Auth0 user not found.";
      } else {
        state.selectedUserPermissions =
          await managementClient.getUserPermissions(state.selectedUser.user_id);
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.logError(error, { userId: selectedUserId });
      } else {
        logger.error('Failed to load Auth0 user profile in admin page', {
          userId: selectedUserId,
          errorMessage: String(error),
        });
      }
      state.selectedUserError =
        error instanceof Auth0ManagementError
          ? error.message
          : "Unable to load Auth0 user profile.";
    }
  } else if (!managementClient && (searchTerm || selectedUserId)) {
    state.selectedUserError =
      "Auth0 management credentials are not configured. Set AUTH0_CLIENT_ID and AUTH0_CLIENT_SECRET to enable this page.";
  }

  const selectedUser = state.selectedUser;
  const selectedUserPermissions = state.selectedUserPermissions;
  const selectedUserError = state.selectedUserError;

  const selectedUserName = summarizeUser(selectedUser);
  const permissionsByName = new Set(
    selectedUserPermissions.map(
      (permission) => permission.permission_name
    )
  );

  const permissionNotice =
    permissionErrorMsg && permissionCode
      ? {
          variant: "error" as const,
          message: `Unable to update ${formatPermissionLabel(
            permissionCode
          )}: ${permissionErrorMsg}`,
        }
      : permissionStatus && permissionCode
      ? {
          variant: "success" as const,
          message:
            permissionStatus === "revoke"
              ? `${formatPermissionLabel(
                  permissionCode
                )} removed for ${selectedUserName}.`
              : `${formatPermissionLabel(
                  permissionCode
                )} granted for ${selectedUserName}.`,
        }
      : null;

  return c.html(
    <Layout title="User administration">
      <style>
        {`
          .search-card {
            margin-bottom: var(--space-l);
          }
          .user-results {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
          }
          .user-results__item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-s);
            border: 1px solid rgba(10, 22, 94, 0.1);
            border-radius: 12px;
            padding: var(--space-s);
            background: #fff;
          }
          .user-results__meta {
            margin: 0;
            color: var(--color-neutral-grey);
            font-size: var(--text--1);
          }
          .permissions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: var(--space-m);
          }
          .permission-card {
            border: 1px solid rgba(10, 22, 94, 0.1);
            border-radius: 16px;
            padding: var(--space-m);
            background: #f8fafc;
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
          }
          .permission-card__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-s);
          }
          .permission-card__title {
            margin: 0;
          }
          .permission-card__hint {
            color: var(--color-neutral-grey);
            margin: 0;
            font-size: var(--text--1);
          }
          .permission-card form {
            margin: 0;
          }
          .user-profile {
            border: 1px solid rgba(10, 22, 94, 0.12);
            border-radius: 16px;
            padding: var(--space-m);
            background: var(--color-white);
          }
          .profile-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: var(--space-m);
            margin: 0;
          }
          .profile-grid dt {
            font-size: var(--text--1);
            color: var(--color-neutral-grey);
            font-weight: 500;
            margin-bottom: var(--space-3xs);
          }
          .profile-grid dd {
            margin: 0;
            font-weight: 600;
            color: var(--color-primary-navy);
          }
          .permission-badges {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2xs);
            margin-top: var(--space-s);
          }
          .notification {
            border-radius: 12px;
          }
        `}
      </style>

      <div class="page-header">
        <div>
          <p class="form-label" style="margin: 0;">
            User tooling
          </p>
          <h1 style="margin: var(--space-3xs) 0;">User administration</h1>
          <p style="color: var(--color-neutral-grey); margin: 0;">
            Search Auth0 users, view their permissions, and manage access
            without leaving the dashboard.
          </p>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: var(--space-s);">
          <Button variant="secondary" href="/admin/users/statistics">
            Go to user statistics
          </Button>
          <Button variant="secondary" href="/admin/loos">
            Back to dataset
          </Button>
        </div>
      </div>

      {!state.managementConfigured && (
        <div
          class="notification notification--error"
          style="margin-bottom: var(--space-l);"
        >
          <div class="notification__icon">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          </div>
          <div class="notification__content">
            <p class="notification__title">Auth0 management disabled</p>
            <p class="notification__message">
              Provide <code>AUTH0_MANAGEMENT_CLIENT_ID</code> and{" "}
              <code>AUTH0_MANAGEMENT_CLIENT_SECRET</code> to enable user
              administration tools.
            </p>
          </div>
        </div>
      )}

      {permissionNotice && (
        <div
          class={`notification notification--${permissionNotice.variant}`}
          style="margin-bottom: var(--space-l);"
        >
          <div class="notification__icon">
            <i
              class={`fa-solid ${
                permissionNotice.variant === "error"
                  ? "fa-circle-exclamation"
                  : "fa-circle-check"
              }`}
              aria-hidden="true"
            ></i>
          </div>
          <div class="notification__content">
            <p class="notification__title">
              {permissionNotice.variant === "error"
                ? "Permission update failed"
                : "Permission updated"}
            </p>
            <p class="notification__message">{permissionNotice.message}</p>
          </div>
        </div>
      )}

      <CollapsibleCard
        id="user-admin-search"
        eyebrow="Search Auth0"
        title="Find a user"
        description="Search by email, name, or Auth0 ID. Results are limited to 6 matches."
        showLabel="Show search"
        hideLabel="Hide search"
        className="search-card"
      >
        <form
          method="get"
          data-autosubmit="search"
          data-allow-empty="true"
          class="search-form"
          style="margin-bottom: var(--space-m);"
        >
          {selectedUserId && (
            <input type="hidden" name="user" value={selectedUserId} />
          )}
          <label class="form-label" for="user-admin-search-input">
            Email, name, or Auth0 ID
          </label>
          <div class="search-input-wrapper">
            <input
              class="input search-input"
              type="text"
              id="user-admin-search-input"
              name="search"
              placeholder="e.g. alex@example.com"
              value={searchTerm}
              autocomplete="off"
            />
            {searchTerm && (
              <button
                type="button"
                class="search-clear-btn"
                data-clear-search
                aria-label="Clear search"
              >
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            )}
          </div>
        </form>

        {state.searchError && (
          <div class="notification notification--error">
            <div class="notification__icon">
              <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
            </div>
            <div class="notification__content">
              <p class="notification__title">Search unavailable</p>
              <p class="notification__message">{state.searchError}</p>
            </div>
          </div>
        )}

        {!state.managementConfigured && searchTerm && (
          <p class="muted-text" style="margin: 0;">
            Search results are unavailable until Auth0 management credentials
            are configured.
          </p>
        )}

        {state.managementConfigured && !state.searchError && searchTerm && (
          <>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-xs);">
              <strong>Matches for “{searchTerm}”</strong>
              <span class="muted-text">
                {state.searchResults.length
                  ? "Select a user to manage permissions"
                  : "No matches found"}
              </span>
            </div>
            {state.searchResults.length ? (
              <ul class="user-results">
                {state.searchResults.map((user) => (
                  <li class="user-results__item" key={user.user_id}>
                    <div>
                      <strong>
                        {user.name ||
                          user.nickname ||
                          user.email ||
                          user.user_id}
                      </strong>
                      <p class="user-results__meta">
                        {user.email || "No email"} · {user.user_id}
                      </p>
                    </div>
                    <a
                      class="button"
                      href={buildManageLink(user.user_id, searchTerm)}
                    >
                      Manage
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted-text" style="margin: 0;">
                Try a different email or handle.
              </p>
            )}
          </>
        )}
      </CollapsibleCard>

      {selectedUserId && !selectedUser && (
        <div
          class="notification notification--error"
          style="margin-bottom: var(--space-l);"
        >
          <div class="notification__icon">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          </div>
          <div class="notification__content">
            <p class="notification__title">Unable to load user</p>
            <p class="notification__message">
              {selectedUserError ?? "Select a different user to continue."}
            </p>
          </div>
        </div>
      )}

      {selectedUser && (
        <>
          <section class="user-profile" style="margin-bottom: var(--space-l);">
            <div class="section-header" style="margin-bottom: var(--space-m);">
              <div>
                <p class="section-eyebrow">Selected user</p>
                <h2 class="section-title" style="margin: 0;">
                  {selectedUser.name ||
                    selectedUser.nickname ||
                    selectedUser.email ||
                    selectedUser.user_id}
                </h2>
                <p
                  class="section-description"
                  style="margin-top: var(--space-3xs);"
                >
                  Auth0 ID: <code>{selectedUser.user_id}</code>
                </p>
              </div>
              <Button variant="secondary" href="/admin/users/statistics">
                View statistics
              </Button>
            </div>
            <dl class="profile-grid">
              <div>
                <dt>Email</dt>
                <dd>{selectedUser.email || "—"}</dd>
              </div>
              <div>
                <dt>Last login</dt>
                <dd>{formatDateTime(selectedUser.last_login)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(selectedUser.created_at)}</dd>
              </div>
              <div>
                <dt>Logins</dt>
                <dd>
                  {numberFormatter.format(selectedUser.logins_count ?? 0)}
                </dd>
              </div>
            </dl>

            <div style="margin-top: var(--space-m);">
              <p class="form-label" style="margin-bottom: var(--space-2xs);">
                Current permissions
              </p>
              {selectedUserPermissions.length ? (
                <div class="permission-badges">
                  {selectedUserPermissions.map((permission) => (
                    <Badge
                      key={`${permission.permission_name}-${permission.resource_server_identifier}`}
                      variant="neutral"
                    >
                      {permission.permission_name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p class="muted-text" style="margin: 0;">
                  No permissions assigned for this API.
                </p>
              )}
            </div>
          </section>

          <section class="form-card" style="margin-bottom: var(--space-l);">
            <div class="section-header" style="margin-bottom: var(--space-m);">
              <div>
                <p class="section-eyebrow">Manage permissions</p>
                <h2 class="section-title" style="margin: 0;">
                  Assign roles for {selectedUserName}
                </h2>
              </div>
            </div>
            <div class="permissions-grid">
              {userPermissionOrder.map((permissionKey) => {
                const isGranted = permissionsByName.has(permissionKey);
                const intent = isGranted ? "revoke" : "grant";
                return (
                  <article class="permission-card" key={permissionKey}>
                    <div class="permission-card__header">
                      <div>
                        <h3 class="permission-card__title">
                          {PERMISSION_LABELS[permissionKey]}
                        </h3>
                        <p class="permission-card__hint">
                          {permissionDescription[permissionKey]}
                        </p>
                      </div>
                      <Badge variant={isGranted ? "yes" : "no"}>
                        {isGranted ? "Granted" : "Not granted"}
                      </Badge>
                    </div>
                    <form method="post" action="/admin/users/admin/permissions">
                      <input
                        type="hidden"
                        name="user_id"
                        value={selectedUser.user_id}
                      />
                      <input
                        type="hidden"
                        name="permission"
                        value={permissionKey}
                      />
                      <input type="hidden" name="intent" value={intent} />
                      <input
                        type="hidden"
                        name="redirect_to"
                        value={buildManageLink(
                          selectedUser.user_id,
                          searchTerm
                        )}
                      />
                      <Button type="submit">
                        {isGranted
                          ? `Remove ${PERMISSION_LABELS[permissionKey]}`
                          : `Grant ${PERMISSION_LABELS[permissionKey]}`}
                      </Button>
                    </form>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </Layout>
  );
};

export const updateUserPermissions = async (c: AdminContext) => {
  const managementClient = Auth0ManagementClient.fromEnv(c.env);
  const form = await c.req.formData();
  const userId = (form.get("user_id") ?? "").toString().trim();
  const permission = (form.get("permission") ?? "").toString().trim();
  const intent = (form.get("intent") ?? "").toString().trim();
  const redirectInput = (form.get("redirect_to") ?? "").toString();

  const redirectUrl = buildRedirectUrl(redirectInput, userId || undefined);
  redirectUrl.searchParams.delete("permissionStatus");
  redirectUrl.searchParams.delete("permissionError");
  redirectUrl.searchParams.delete("permission");

  const addError = (message: string) => {
    redirectUrl.searchParams.set("permissionError", message);
    if (permission) {
      redirectUrl.searchParams.set("permission", permission);
    }
    return c.redirect(`${redirectUrl.pathname}${redirectUrl.search}`, 303);
  };

  if (!managementClient) {
    return addError(
      "Auth0 management credentials are not configured. Ask an engineer to set AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET."
    );
  }

  if (!userId) {
    return addError("Missing Auth0 user ID.");
  }

  if (!permission) {
    return addError("Missing permission name.");
  }

  if (!(KNOWN_PERMISSIONS as readonly string[]).includes(permission)) {
    return addError("Unsupported permission toggle.");
  }

  if (intent !== "grant" && intent !== "revoke") {
    return addError("Unsupported action.");
  }

  try {
    if (intent === "grant") {
      await managementClient.addPermissions(userId, [permission]);
    } else {
      await managementClient.removePermissions(userId, [permission]);
    }
    redirectUrl.searchParams.set("permissionStatus", intent);
    redirectUrl.searchParams.set("permission", permission);
    redirectUrl.searchParams.delete("permissionError");
    return c.redirect(`${redirectUrl.pathname}${redirectUrl.search}`, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update permission.";
    return addError(message);
  }
};
