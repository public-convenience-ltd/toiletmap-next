export type Auth0User = {
  sub?: string;
  name?: string;
  nickname?: string;
  email?: string;
  permissions?: string[];
  [key: string]: unknown;
};

export type RequestUser = Auth0User & {
  sub: string;
};

export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  nickname?: string;
  [key: string]: unknown;
}

export interface SessionData {
  idToken: string;
  accessToken: string;
  user: SessionUser;
}

export interface AuthEnv {
  AUTH0_AUDIENCE: string;
  AUTH0_ISSUER_BASE_URL: string;
}
