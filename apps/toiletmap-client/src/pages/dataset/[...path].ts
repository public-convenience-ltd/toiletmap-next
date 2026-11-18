import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { serveDatasetFile } from "../../utils/dataset";

/**
 * Dataset downloads, `/dataset/latest/*` and `/dataset/archive/*`, from the
 * EXPORTS R2 bucket (production only). See `serveDatasetFile` for the rules;
 * `/dataset` itself is the page (dataset.astro).
 */
export const prerender = false;

export const ALL: APIRoute = ({ request, params }) =>
  serveDatasetFile({ request, bucket: env.EXPORTS, path: params.path ?? "" });
