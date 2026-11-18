import type { APIRoute } from "astro";
import { legacyRedirectResponse } from "../../../utils/legacyRedirects";

/** The legacy Decap CMS GitHub sign-in (/api/decap-oauth[/callback]): 301 to /api/cms-oauth/*. See src/utils/legacyRedirects.ts and docs/security.md. */
export const prerender = false;

export const ALL: APIRoute = ({ url }) => legacyRedirectResponse(url);
