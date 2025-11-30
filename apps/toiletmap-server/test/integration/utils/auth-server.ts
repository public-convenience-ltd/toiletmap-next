import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type IssueTokenFn = (claims?: Record<string, unknown>) => string;

export type AuthServer = {
  issuer: string;
  issueToken: IssueTokenFn;
  stop: () => Promise<void>;
};

type StartAuthServerOptions = {
  audience: string;
  port?: number; // Optional fixed port (default: random)
};

type AuthCodeMetadata = {
  nonce: string;
  audience: string;
  scope: string;
  profile: UserProfile;
};

// In-memory store for authorization codes (maps code -> metadata)
const authCodes = new Map<string, AuthCodeMetadata>();
const accessTokenProfiles = new Map<string, UserProfile>();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const signJwt = (
  payload: Record<string, unknown>,
  privateKey: string,
  options: {
    kid: string;
    audience?: string | string[];
    issuer?: string;
    expiresIn?: number;
  },
) => {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: options.kid,
  };

  const now = Math.floor(Date.now() / 1000);
  const exp = options.expiresIn ? now + options.expiresIn : now + 24 * 60 * 60;

  const fullPayload = {
    ...payload,
    aud: options.audience,
    iss: options.issuer,
    iat: now,
    exp,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");

  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createSign("RSA-SHA256").update(data).sign(privateKey, "base64url");

  return `${data}.${signature}`;
};

type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  scope: string;
  audience: string;
};

type CustomizationFormState = {
  name: string;
  email: string;
  nickname: string;
  sub: string;
  picture: string;
  contributorName: string;
  scope: string;
  permissions: string[];
  extraPermissions: string;
  customClaims: string;
};

type UserProfile = {
  sub: string;
  name: string;
  email: string;
  nickname: string;
  picture?: string;
  permissions: string[];
  contributorName?: string;
  customClaims: Record<string, unknown>;
};

type ApprovalCustomization = {
  scope: string;
  profile: UserProfile;
};

type CustomizationParseResult =
  | { success: true; customization: ApprovalCustomization; formState: CustomizationFormState }
  | { success: false; errors: string[]; formState: CustomizationFormState };

const DEFAULT_PERMISSIONS = ["access:admin", "report:loo"];

const toInitials = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "TU";
  }
  const parts = trimmed.split(/\s+/u).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "TU";
};

const buildDefaultFormState = (params: AuthorizeParams): CustomizationFormState => ({
  name: "Test User",
  email: "test@localhost",
  nickname: "testuser",
  sub: "auth0|test-user",
  picture: "",
  contributorName: "Test User",
  scope: params.scope,
  permissions: [...DEFAULT_PERMISSIONS],
  extraPermissions: "",
  customClaims: "",
});

const buildDefaultCustomization = (params: AuthorizeParams): ApprovalCustomization => ({
  scope: params.scope,
  profile: {
    sub: "auth0|test-user",
    name: "Test User",
    email: "test@localhost",
    nickname: "testuser",
    permissions: [...DEFAULT_PERMISSIONS],
    contributorName: "Test User",
    customClaims: {},
  },
});

const normalizePermissions = (values: string[]) => {
  return Array.from(new Set(values.map((perm) => perm.trim()).filter((perm) => perm.length > 0)));
};

const parseCustomizationForm = (
  form: URLSearchParams,
  params: AuthorizeParams,
): CustomizationParseResult => {
  const defaults = buildDefaultFormState(params);

  const formState: CustomizationFormState = {
    name: form.get("user_name")?.trim() || defaults.name,
    email: form.get("user_email")?.trim() || defaults.email,
    nickname: form.get("user_nickname")?.trim() || defaults.nickname,
    sub: form.get("user_sub")?.trim() || defaults.sub,
    picture: form.get("user_picture")?.trim() || "",
    contributorName: form.get("contributor_name")?.trim() || "",
    scope: form.get("scope")?.trim() || defaults.scope,
    permissions: normalizePermissions(form.getAll("permissions")),
    extraPermissions: form.get("extra_permissions") ?? "",
    customClaims: form.get("custom_claims") ?? "",
  };

  const errors: string[] = [];

  const extraPermissions = normalizePermissions(
    formState.extraPermissions.split(/[\n,]+/u).map((value) => value.trim()),
  );

  const permissions = normalizePermissions([...formState.permissions, ...extraPermissions]);

  let customClaims: Record<string, unknown> = {};
  if (formState.customClaims.trim().length > 0) {
    try {
      const parsed = JSON.parse(formState.customClaims);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push("Custom claim overrides must be a valid JSON object.");
      } else {
        customClaims = parsed as Record<string, unknown>;
      }
    } catch (_error) {
      errors.push("Custom claim overrides must be valid JSON.");
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      formState: { ...formState, permissions: formState.permissions },
    };
  }

  return {
    success: true,
    customization: {
      scope: formState.scope,
      profile: {
        sub: formState.sub,
        name: formState.name,
        email: formState.email,
        nickname: formState.nickname,
        picture: formState.picture || undefined,
        permissions: permissions.length > 0 ? permissions : [],
        contributorName: formState.contributorName || undefined,
        customClaims,
      },
    },
    formState,
  };
};

const createBaseClaims = (profile: UserProfile): Record<string, unknown> => {
  const claims: Record<string, unknown> = {
    sub: profile.sub,
    name: profile.name,
    nickname: profile.nickname,
    email: profile.email,
  };
  if (profile.picture) {
    claims.picture = profile.picture;
  }
  return claims;
};

const applyContributorName = (claims: Record<string, unknown>, contributorName?: string) => {
  if (!contributorName) {
    return;
  }
  const existing = claims.app_metadata;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    claims.app_metadata = {
      ...(existing as Record<string, unknown>),
      contributor_name: contributorName,
    };
  } else {
    claims.app_metadata = { contributor_name: contributorName };
  }
};

const buildAccessTokenPayload = (profile: UserProfile): Record<string, unknown> => {
  const claims: Record<string, unknown> = {
    ...(profile.customClaims ?? {}),
    ...createBaseClaims(profile),
    permissions: profile.permissions,
  };
  applyContributorName(claims, profile.contributorName);
  return claims;
};

const buildIdTokenPayload = (profile: UserProfile, nonce: string): Record<string, unknown> => {
  const claims: Record<string, unknown> = {
    ...(profile.customClaims ?? {}),
    ...createBaseClaims(profile),
  };
  applyContributorName(claims, profile.contributorName);
  claims.nonce = nonce;
  return claims;
};

const buildUserInfoPayload = (profile: UserProfile): Record<string, unknown> => {
  const claims: Record<string, unknown> = {
    ...(profile.customClaims ?? {}),
    ...createBaseClaims(profile),
  };
  if (profile.permissions.length > 0) {
    claims.permissions = profile.permissions;
  }
  applyContributorName(claims, profile.contributorName);
  return claims;
};

const parseAuthorizeParams = (
  params: URLSearchParams,
  defaultAudience: string,
): AuthorizeParams | null => {
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const nonce = params.get("nonce");
  const scope = params.get("scope") ?? "openid profile email";
  const audience = params.get("audience") ?? defaultAudience;

  if (!clientId || !redirectUri || !state || !nonce) {
    return null;
  }

  return {
    clientId,
    redirectUri,
    state,
    nonce,
    scope,
    audience,
  };
};

const renderLoginPage = (
  params: AuthorizeParams,
  formState: CustomizationFormState = buildDefaultFormState(params),
  errors: string[] = [],
) => {
  const { clientId, scope, audience, redirectUri, state, nonce } = params;
  const safe = {
    clientId: escapeHtml(clientId),
    scope: escapeHtml(formState.scope || scope),
    audience: escapeHtml(audience),
    redirectUri: escapeHtml(redirectUri),
    state: escapeHtml(state),
    nonce: escapeHtml(nonce),
  };

  const safeForm = {
    name: escapeHtml(formState.name),
    email: escapeHtml(formState.email),
    nickname: escapeHtml(formState.nickname),
    sub: escapeHtml(formState.sub),
    picture: escapeHtml(formState.picture),
    contributorName: escapeHtml(formState.contributorName),
    scope: escapeHtml(formState.scope),
    extraPermissions: escapeHtml(formState.extraPermissions),
    customClaims: escapeHtml(formState.customClaims),
  };

  const extraPermissions = normalizePermissions(
    formState.extraPermissions.split(/[\n,]+/u).map((value) => value.trim()),
  );
  const previewPermissions = normalizePermissions([...formState.permissions, ...extraPermissions]);
  const permissionsMarkup =
    previewPermissions.length === 0
      ? '<span class="pill pill--muted">No permissions</span>'
      : previewPermissions.map((perm) => `<span class="pill">${escapeHtml(perm)}</span>`).join("");

  const errorMarkup =
    errors.length > 0
      ? `<div class="alert">${errors
          .map((message) => `<p>${escapeHtml(message)}</p>`)
          .join("")}</div>`
      : "";

  const isPermissionChecked = (value: string) =>
    formState.permissions.includes(value) ? "checked" : "";

  const avatarInitials = escapeHtml(toInitials(formState.name));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Local Auth Server · Toilet Map Login</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --color-primary-navy: #0a165e;
        --color-accent-turquoise: #92f9db;
        --color-accent-pink: #ed3d62;
        --color-frost-ice: #d2fff2;
        --color-base-white: #ffffff;
        --color-neutral-grey: #807f7f;
      }

      * {
        box-sizing: border-box;
        font-family: 'Open Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at top, rgba(146, 249, 219, 0.25), transparent 45%),
          radial-gradient(circle at 20% 20%, rgba(237, 61, 98, 0.12), transparent 35%),
          var(--color-primary-navy);
        color: var(--color-primary-navy);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      .auth-shell {
        width: min(1080px, 100%);
        background: var(--color-base-white);
        border-radius: 28px;
        box-shadow: 0 35px 95px rgba(10, 22, 94, 0.35);
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
        overflow: hidden;
        border: 1px solid rgba(10, 22, 94, 0.08);
      }

      .auth-panel {
        padding: 48px;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .auth-panel--info {
        background: linear-gradient(160deg, #fefefe, #f6fbff);
        border-right: 1px solid rgba(10, 22, 94, 0.08);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px;
        border-radius: 999px;
        border: 2px solid var(--color-accent-turquoise);
        color: var(--color-primary-navy);
        font-weight: 600;
        text-transform: uppercase;
        font-size: 0.75rem;
      }

      h1 {
        font-size: clamp(2rem, 2.4vw, 2.75rem);
        margin: 0;
        color: var(--color-primary-navy);
      }

      p {
        margin: 0;
        color: var(--color-neutral-grey);
        line-height: 1.6;
      }

      .benefits {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .benefits li {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 600;
        color: var(--color-primary-navy);
      }

      .benefits span {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(10, 22, 94, 0.08);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.95rem;
      }

      .auth-panel--form {
        background: linear-gradient(180deg, rgba(146, 249, 219, 0.12), rgba(146, 249, 219, 0));
      }

      .user-card {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 20px;
        border-radius: 18px;
        background: rgba(146, 249, 219, 0.3);
        border: 2px solid rgba(10, 22, 94, 0.08);
        box-shadow: inset 0 0 0 1px rgba(146, 249, 219, 0.3);
      }

      .avatar {
        width: 56px;
        height: 56px;
        border-radius: 16px;
        background: var(--color-primary-navy);
        color: var(--color-accent-turquoise);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 1.2rem;
      }

      .user-card strong {
        font-size: 1.1rem;
        color: var(--color-primary-navy);
      }

      .permissions {
        display: inline-flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 4px;
      }

      .pill {
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 0.85rem;
        font-weight: 600;
        background: rgba(10, 22, 94, 0.08);
        color: var(--color-primary-navy);
      }

      .pill--muted {
        opacity: 0.6;
      }

      .meta {
        background: var(--color-base-white);
        border-radius: 20px;
        border: 1px solid rgba(10, 22, 94, 0.08);
        padding: 20px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px 18px;
      }

      .meta dt {
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-neutral-grey);
        margin: 0 0 4px;
      }

      .meta dd {
        margin: 0;
        color: var(--color-primary-navy);
        font-weight: 600;
        word-break: break-word;
      }

      form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .form-section {
        background: rgba(255, 255, 255, 0.85);
        border: 1px solid rgba(10, 22, 94, 0.08);
        border-radius: 18px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .form-section h3 {
        margin: 0;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(10, 22, 94, 0.7);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .field label {
        font-weight: 600;
        color: var(--color-primary-navy);
      }

      .field input,
      .field textarea {
        width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(10, 22, 94, 0.2);
        padding: 10px 12px;
        font-size: 0.95rem;
        background: var(--color-base-white);
      }

      .field textarea {
        min-height: 64px;
        font-family: inherit;
        resize: vertical;
      }

      .field-help {
        font-size: 0.85rem;
        color: var(--color-neutral-grey);
      }

      .toggle-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 10px;
      }

      .pill-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(10, 22, 94, 0.2);
        border-radius: 999px;
        padding: 8px 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .pill-toggle input {
        accent-color: var(--color-primary-navy);
      }

      .alert {
        border-radius: 16px;
        border: 2px solid rgba(237, 61, 98, 0.3);
        background: rgba(237, 61, 98, 0.1);
        padding: 16px;
        color: var(--color-primary-navy);
      }

      .alert p {
        margin: 0;
        font-weight: 600;
        color: var(--color-primary-navy);
      }

      button {
        width: 100%;
        padding: 16px 20px;
        border-radius: 999px;
        border: none;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        color: var(--color-primary-navy);
        background: var(--color-accent-turquoise);
        box-shadow: 0 18px 30px rgba(146, 249, 219, 0.4);
        transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
      }

      button:hover {
        transform: translateY(-2px);
        box-shadow: 0 25px 35px rgba(146, 249, 219, 0.55);
      }

      button:active {
        transform: translateY(0);
      }

      small {
        font-size: 0.85rem;
        color: var(--color-neutral-grey);
        text-align: center;
      }

      .footnote {
        margin-top: auto;
        border-top: 1px solid rgba(10, 22, 94, 0.08);
        padding-top: 16px;
      }

      @media (max-width: 1100px) {
        .auth-shell {
          grid-template-columns: 1fr;
        }

        .auth-panel--info {
          border-right: none;
          border-bottom: 1px solid rgba(10, 22, 94, 0.08);
        }
      }

      @media (max-width: 560px) {
        body {
          padding: 12px;
        }

        .auth-panel {
          padding: 24px;
        }

        .benefits span {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="auth-shell">
      <div class="auth-panel auth-panel--info">
        <span class="badge">Toilet Map Admin</span>
        <div>
          <h1>Sign in to Toilet Map</h1>
          <p>Authenticate with the local OAuth server to access dataset management, audit trails, and contributor tooling.</p>
        </div>
        <ul class="benefits">
          <li><span>01</span>Manage loos and areas</li>
          <li><span>02</span>Review audit history</li>
          <li><span>03</span>Configure contributor access</li>
        </ul>
        <div class="footnote">
          <small>This flow mirrors the production Auth0 experience so you can test securely in development.</small>
        </div>
      </div>
      <div class="auth-panel auth-panel--form">
        <div class="user-card">
          <div class="avatar" data-preview="avatar">${avatarInitials}</div>
          <div>
            <strong data-preview="name">${safeForm.name}</strong>
            <div data-preview="email">${safeForm.email}</div>
            <div class="permissions" data-preview="permissions">${permissionsMarkup}</div>
          </div>
        </div>

        <dl class="meta">
          <div>
            <dt>Client ID</dt>
            <dd>${safe.clientId}</dd>
          </div>
          <div>
            <dt>Audience</dt>
            <dd>${safe.audience}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd data-preview="scope">${safe.scope}</dd>
          </div>
        </dl>

        ${errorMarkup}

        <form method="post" action="/authorize" id="auth-form" novalidate>
          <div class="form-section">
            <h3>Identity</h3>
            <div class="field">
              <label for="user_name">Full name</label>
              <input id="user_name" name="user_name" value="${safeForm.name}" data-preview-source="name" />
            </div>
            <div class="field">
              <label for="user_email">Email</label>
              <input id="user_email" name="user_email" type="email" value="${safeForm.email}" data-preview-source="email" />
            </div>
            <div class="field">
              <label for="user_sub">Subject (sub)</label>
              <input id="user_sub" name="user_sub" value="${safeForm.sub}" />
              <span class="field-help">Matches Auth0 user_id. Useful for impersonation.</span>
            </div>
            <div class="field">
              <label for="user_nickname">Nickname</label>
              <input id="user_nickname" name="user_nickname" value="${safeForm.nickname}" />
            </div>
            <div class="field">
              <label for="user_picture">Avatar URL (optional)</label>
              <input id="user_picture" name="user_picture" value="${safeForm.picture}" data-preview-source="picture" />
            </div>
          </div>

          <div class="form-section">
            <h3>Permissions</h3>
            <div class="toggle-grid">
              <label class="pill-toggle">
                <input type="checkbox" name="permissions" value="access:admin" ${isPermissionChecked("access:admin")} />
                <span>access:admin</span>
              </label>
              <label class="pill-toggle">
                <input type="checkbox" name="permissions" value="report:loo" ${isPermissionChecked("report:loo")} />
                <span>report:loo</span>
              </label>
            </div>
            <div class="field">
              <label for="extra_permissions">Extra permissions</label>
              <textarea id="extra_permissions" name="extra_permissions" data-preview-source="permissions">${safeForm.extraPermissions}</textarea>
              <span class="field-help">Comma or newline separated. Useful for experimental flags.</span>
            </div>
            <div class="field">
              <label for="contributor_name">Contributor name</label>
              <input id="contributor_name" name="contributor_name" value="${safeForm.contributorName}" />
              <span class="field-help">Populates <code>app_metadata.contributor_name</code>.</span>
            </div>
          </div>

          <div class="form-section">
            <h3>Tokens</h3>
            <div class="field">
              <label for="scope">Scope</label>
              <input id="scope" name="scope" value="${safeForm.scope}" data-preview-source="scope" />
              <span class="field-help">Defaults to requested scope. Supports space separated values.</span>
            </div>
            <div class="field">
              <label for="custom_claims">Custom claim overrides (JSON)</label>
              <textarea id="custom_claims" name="custom_claims" spellcheck="false">${safeForm.customClaims}</textarea>
              <span class="field-help" data-json-error></span>
            </div>
          </div>

          <input type="hidden" name="client_id" value="${safe.clientId}" />
          <input type="hidden" name="redirect_uri" value="${safe.redirectUri}" />
          <input type="hidden" name="state" value="${safe.state}" />
          <input type="hidden" name="nonce" value="${safe.nonce}" />
          <input type="hidden" name="audience" value="${safe.audience}" />

          <button type="submit" data-preview="submit-label">Continue as ${safeForm.name}</button>
        </form>

        <small>Local auth server · Simulated Auth0 login</small>
      </div>
    </div>
    <script>
      (function() {
        const form = document.getElementById('auth-form');
        if (!form) return;

        const preview = {
          name: document.querySelector('[data-preview="name"]'),
          email: document.querySelector('[data-preview="email"]'),
          avatar: document.querySelector('[data-preview="avatar"]'),
          permissions: document.querySelector('[data-preview="permissions"]'),
          scope: document.querySelector('[data-preview="scope"]'),
          submit: document.querySelector('[data-preview="submit-label"]'),
        };

        const inputs = form.querySelectorAll('[data-preview-source]');
        const checkboxSelector = 'input[name="permissions"]';

        const renderPermissions = () => {
          const checked = Array.from(form.querySelectorAll(checkboxSelector))
            .filter((input) => input instanceof HTMLInputElement && input.checked)
            .map((input) => (input as HTMLInputElement).value.trim());
          const extrasField = form.querySelector('textarea[name="extra_permissions"]') as HTMLTextAreaElement | null;
          const extras = extrasField?.value
            ? extrasField.value
                .split(/[\n,]+/)
                .map((value) => value.trim())
                .filter(Boolean)
            : [];
          const values = Array.from(new Set([...checked, ...extras]));
          if (preview.permissions) {
            preview.permissions.innerHTML = values.length
              ? values.map((value) => '<span class="pill">' + value + '</span>').join('')
              : '<span class="pill pill--muted">No permissions</span>';
          }
        };

        const updatePreview = () => {
          const nameInput = form.querySelector('input[name="user_name"]') as HTMLInputElement | null;
          const emailInput = form.querySelector('input[name="user_email"]') as HTMLInputElement | null;
          const scopeInput = form.querySelector('input[name="scope"]') as HTMLInputElement | null;
          const name = nameInput?.value?.trim() || 'Test User';
          const email = emailInput?.value?.trim() || 'test@localhost';
          if (preview.name) preview.name.textContent = name;
          if (preview.email) preview.email.textContent = email;
          if (preview.submit) preview.submit.textContent = 'Continue as ' + name;
          if (preview.scope && scopeInput) preview.scope.textContent = scopeInput.value || '${escapeHtml(scope)}';
          if (preview.avatar) {
            const initials = name
              .split(/s+/)
              .slice(0, 2)
              .map((part) => part.charAt(0).toUpperCase())
              .join('') || 'TU';
            preview.avatar.textContent = initials;
          }
        };

        inputs.forEach((input) => {
          input.addEventListener('input', () => {
            if ((input as HTMLElement).dataset.previewSource === 'permissions') {
              renderPermissions();
            } else {
              updatePreview();
            }
          });
        });

        form.querySelectorAll(checkboxSelector).forEach((checkbox) => {
          checkbox.addEventListener('change', renderPermissions);
        });

        const customClaimsField = form.querySelector('textarea[name="custom_claims"]') as HTMLTextAreaElement | null;
        const errorTarget = document.querySelector('[data-json-error]');
        form.addEventListener('submit', (event) => {
          if (!customClaimsField) return;
          if (!customClaimsField.value.trim()) {
            if (errorTarget) errorTarget.textContent = '';
            return;
          }
          try {
            const parsed = JSON.parse(customClaimsField.value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('Custom claim overrides must be a JSON object.');
            }
            if (errorTarget) errorTarget.textContent = '';
          } catch (error) {
            event.preventDefault();
            if (errorTarget) {
              errorTarget.textContent = 'Provide a valid JSON object (e.g. {"app_metadata": {"department": "ops"}}).';
            }
          }
        });

        renderPermissions();
        updatePreview();
      })();
    </script>
  </body>
</html>`;
};

const approveAuthorization = (
  res: ServerResponse,
  params: AuthorizeParams,
  customization?: ApprovalCustomization,
) => {
  const effectiveCustomization = customization ?? buildDefaultCustomization(params);
  const code = randomUUID();
  authCodes.set(code, {
    nonce: params.nonce,
    audience: params.audience,
    scope: effectiveCustomization.scope,
    profile: effectiveCustomization.profile,
  });

  try {
    const callbackUrl = new URL(params.redirectUri);
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", params.state);
    res.writeHead(302, { Location: callbackUrl.toString() });
    res.end();
  } catch (_error) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_redirect_uri" }));
  }
};

/**
 * Starts a tiny JWKS + OAuth2 server so integration tests and local development
 * can exercise the Auth0 middleware end-to-end, including admin UI login.
 */
export const startAuthServer = async (options: StartAuthServerOptions): Promise<AuthServer> => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const kid = randomUUID();
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  const publicJwk = {
    ...jwk,
    kid,
    alg: "RS256",
    use: "sig",
  };

  const server = createServer((req, res) => {
    const reqUrl = req.url ? new URL(req.url, `http://${req.headers.host}`) : null;

    // JWKS endpoint for JWT verification
    if (req.method === "GET" && reqUrl?.pathname === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }

    // OAuth2 authorization endpoint (interactive + auto-approve)
    if (reqUrl?.pathname === "/authorize") {
      if (req.method === "GET") {
        const params = parseAuthorizeParams(reqUrl.searchParams, options.audience);
        if (!params) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "invalid_request",
              error_description: "Missing required parameters",
            }),
          );
          return;
        }

        if (reqUrl.searchParams.get("auto") === "1") {
          approveAuthorization(res, params);
          return;
        }

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderLoginPage(params, buildDefaultFormState(params)));
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          const form = new URLSearchParams(body);
          const params = parseAuthorizeParams(form, options.audience);
          if (!params) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                error: "invalid_request",
                error_description: "Missing required parameters",
              }),
            );
            return;
          }
          const customizationResult = parseCustomizationForm(form, params);
          if (!customizationResult.success) {
            res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
            res.end(
              renderLoginPage(params, customizationResult.formState, customizationResult.errors),
            );
            return;
          }
          approveAuthorization(res, params, customizationResult.customization);
        });
        return;
      }
    }

    // OAuth2 token endpoint
    if (req.method === "POST" && req.url === "/oauth/token") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        try {
          const params = JSON.parse(body);
          const { grant_type, code, client_id } = params;

          if (grant_type !== "authorization_code") {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "unsupported_grant_type" }));
            return;
          }

          const codeMetadata = authCodes.get(code);
          if (!codeMetadata) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                error: "invalid_grant",
                error_description: "Invalid authorization code",
              }),
            );
            return;
          }

          authCodes.delete(code); // One-time use

          const nonce = codeMetadata.nonce;
          const requestedAudience = codeMetadata.audience || options.audience;
          const grantedScope = codeMetadata.scope || "openid profile email";
          const profile = codeMetadata.profile;

          const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }) as string;
          const address = server.address() as AddressInfo;
          const issuer = `http://127.0.0.1:${address.port}/`;

          // Generate access token
          const accessTokenPayload = buildAccessTokenPayload(profile);
          const accessToken = signJwt(accessTokenPayload, privateKeyPem, {
            kid,
            audience: requestedAudience,
            issuer,
            expiresIn: 86400, // 24h in seconds
          });
          accessTokenProfiles.set(accessToken, profile);

          // Generate ID token with nonce
          const idTokenPayload = buildIdTokenPayload(profile, nonce);
          const idToken = signJwt(idTokenPayload, privateKeyPem, {
            kid,
            audience: client_id, // ID token audience is the client_id
            issuer,
            expiresIn: 86400, // 24h in seconds
          });

          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              access_token: accessToken,
              id_token: idToken,
              token_type: "Bearer",
              scope: grantedScope,
              expires_in: 86400,
            }),
          );
        } catch (_error) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "server_error" }));
        }
      });
      return;
    }

    // Userinfo endpoint (optional, for completeness)
    if (req.method === "GET" && req.url === "/userinfo") {
      const authHeader = req.headers.authorization;
      let payload: Record<string, unknown> | null = null;

      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice("Bearer ".length);
        const profile = accessTokenProfiles.get(token);
        if (profile) {
          payload = buildUserInfoPayload(profile);
        }
      }

      if (!payload) {
        payload = {
          sub: "auth0|test-user",
          name: "Test User",
          nickname: "testuser",
          email: "test@localhost",
        };
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Not Found" }));
  });

  await new Promise<void>((resolve) => {
    const port = options.port ?? 0; // Use provided port or random (0)
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${address.port}`;
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }) as string;

  const issueToken: IssueTokenFn = (claims = {}) => {
    const defaults = {
      sub: "auth0|integration-test-user",
      nickname: "integration-test-user",
      name: "Integration Tester",
      app_metadata: {
        nickname: "integration-tester",
      },
    } satisfies Record<string, unknown>;

    const { aud, ...restClaims } = claims;
    const payload = { ...defaults, ...restClaims };

    let audienceOverride: string | string[] | undefined;
    if (typeof aud === "string") {
      audienceOverride = aud;
    } else if (Array.isArray(aud)) {
      const stringAudiences = aud.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      audienceOverride = stringAudiences.length > 0 ? stringAudiences : undefined;
    }

    return signJwt(payload, privateKeyPem, {
      kid,
      audience: audienceOverride ?? options.audience,
      issuer: `${issuer}/`,
    });
  };

  return {
    issuer: `${issuer}/`,
    issueToken,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
};
