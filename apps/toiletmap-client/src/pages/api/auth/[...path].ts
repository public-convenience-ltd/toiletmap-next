import type { APIRoute } from "astro";
import { legacyRedirectResponse } from "../../../utils/legacyRedirects";

/** The legacy Auth0 routes (/api/auth/login, logout, callback): 301 to /auth/*. A static prefix, so it outranks the API proxy. See src/utils/legacyRedirects.ts and docs/security.md. */
export const prerender = false;

export const ALL: APIRoute = ({ url }) => legacyRedirectResponse(url);
