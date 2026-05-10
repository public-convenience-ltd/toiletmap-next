/**
 * Returns the API URL to use. If it's a preview deployment of the client,
 * it dynamically points to the corresponding preview deployment of the server.
 */
export function getApiUrl(env: Env, requestUrl: URL): string {
  const host = requestUrl.host;

  // Cloudflare preview deployments typically have the format `<branch>-<worker_name>...`
  // So if the host contains `-toiletmap-client`, we point it to `-toiletmap-server` on the same branch.
  if (host.includes("-toiletmap-client")) {
    return `https://${host.replace("-toiletmap-client", "-toiletmap-server")}`;
  }

  // For production or local development, use the configured environment variable
  return env.PUBLIC_API_URL;
}
