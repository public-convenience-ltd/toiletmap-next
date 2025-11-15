export type Auth0UserProfile = {
  nickname?: string | null;
  name?: string | null;
  [key: string]: unknown;
};

export type Auth0User = {
  sub?: string;
  name?: string;
  nickname?: string;
  email?: string;
  permissions?: string[];
  [key: string]: unknown;
};

export type AppVariables = {
  user?: Auth0User;
};
