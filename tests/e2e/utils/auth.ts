const DEFAULT_SUBJECT = 'auth0|test-user';

export type IssueTokenOverrides = {
  sub?: string;
  nickname?: string;
  name?: string;
  [key: string]: unknown;
};

export const issueTestToken = (overrides: IssueTokenOverrides = {}) => {
  const server = globalThis.__AUTH_SERVER__;
  if (!server) {
    throw new Error('Auth server not initialised');
  }

  const payload = {
    sub: overrides.sub ?? DEFAULT_SUBJECT,
    nickname: overrides.nickname ?? 'E2E Tester',
    name: overrides.name ?? 'E2E Tester',
    ...overrides,
  };

  return server.issueToken(payload);
};
