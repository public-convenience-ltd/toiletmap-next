import type { APIRoute } from "astro";
import { legacyRedirectResponse } from "../../utils/legacyRedirects";

/** The legacy Decap CMS page (/api/admin): 301 to /cms/. See src/utils/legacyRedirects.ts and docs/security.md. */
export const prerender = false;

export const ALL: APIRoute = ({ url }) => legacyRedirectResponse(url);
