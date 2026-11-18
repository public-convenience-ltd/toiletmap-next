import type { APIRoute } from "astro";
import { legacyRedirectResponse } from "../../utils/legacyRedirects";

/** The legacy dataset explorer (/explorer/*): 301 to /dataset, or a toilet's page. See src/utils/legacyRedirects.ts and docs/security.md. */
export const prerender = false;

export const ALL: APIRoute = ({ url }) => legacyRedirectResponse(url);
