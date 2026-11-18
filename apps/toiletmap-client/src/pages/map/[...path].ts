import type { APIRoute } from "astro";
import { legacyRedirectResponse } from "../../utils/legacyRedirects";

/** Legacy map URLs (/map, /map/:lng/:lat[/:zoom]): 301 to the map at that view. See src/utils/legacyRedirects.ts and docs/security.md. */
export const prerender = false;

export const ALL: APIRoute = ({ url }) => legacyRedirectResponse(url);
