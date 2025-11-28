import { Context } from 'hono';
import { Layout } from '../../components/Layout';
import { ADMIN_ROLE_ID } from '../../../middleware/require-admin-role';
import { AppVariables, Env, RequestUser } from '../../../types';

type AccessDeniedProps = {
    user?: RequestUser;
};

const getDisplayName = (user?: RequestUser) =>
    user?.name || user?.nickname || user?.email || user?.sub || 'there';

const getIdentityLabel = (user?: RequestUser) =>
    user?.email || user?.name || user?.nickname || user?.sub || null;

const AccessDeniedPage = ({ user }: AccessDeniedProps) => {
    const displayName = getDisplayName(user);
    const identityLabel = getIdentityLabel(user);

    return (
        <Layout title="Admin access required">
            <section class="empty-state" style="margin-top: var(--space-xl);">
                <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
                <h3>Admin access required</h3>
                <p>
                    Hi {displayName}, your account does not have the required{' '}
                    <code>{ADMIN_ROLE_ID}</code> permission. The dataset explorer and contributor tooling are reserved
                    for Toilet Map administrators.
                </p>
                {identityLabel && (
                    <p style="margin-top: var(--space-s);">
                        You are currently signed in as <strong>{identityLabel}</strong>.
                    </p>
                )}
                <p style="margin-top: var(--space-s);">
                    Please ask your project administrator to grant you access, or sign out below to switch to a different
                    account.
                </p>
                <div
                    style="
                        margin-top: var(--space-m);
                        display: flex;
                        gap: var(--space-s);
                        flex-wrap: wrap;
                        justify-content: center;
                    "
                >
                    <a class="button" href="/admin/logout">
                        Switch account
                    </a>
                    <a class="button button--secondary" href="/">
                        Return to Toilet Map
                    </a>
                </div>
            </section>
        </Layout>
    );
};

export const renderAccessDenied = (
    c: Context<{ Bindings: Env; Variables: AppVariables }>,
    user?: RequestUser,
) => c.html(<AccessDeniedPage user={user ?? c.get('user')} />, 403);
