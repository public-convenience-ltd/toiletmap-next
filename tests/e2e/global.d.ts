import type { TestAuthServer } from './utils/auth-server';

declare global {
  var __AUTH_SERVER__: TestAuthServer | undefined;
}

export {};
