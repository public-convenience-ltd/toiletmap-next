import type { APIRoute } from "astro";
import { legacyRedirectResponse } from "../utils/legacyRedirects";

/** The legacy /login page: 301 to /auth/login, keeping a same-origin returnTo. See src/utils/legacyRedirects.ts and docs/security.md. */
export const prerender = false;

export const ALL: APIRoute = ({ url }) => legacyRedirectResponse(url);
