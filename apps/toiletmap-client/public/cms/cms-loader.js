// Loads Sveltia CMS for /cms (see apps/toiletmap-client/docs/cms.md).
//
// 1. Asks /api/cms-oauth/status whether GitHub sign-in is set up. If it isn't, shows why
//    (with a button to open the editor anyway, for access-token or local-repository use).
// 2. Loads the pinned Sveltia CMS build from the CDN, checked against its SRI hash. Sveltia
//    loads its own extra chunks from the same pinned version.
// 3. Starts it with config.yml plus one override: the OAuth popup goes to this page's own
//    origin (/api/cms-oauth/auth), so the token is only ever handed to this site.
//
// To upgrade Sveltia: pick a version at least two weeks old, then update SVELTIA_VERSION and
// SVELTIA_INTEGRITY (docs/cms.md has the command that prints the hash).
(() => {
  "use strict";

  const SVELTIA_VERSION = "0.258.1";
  const SVELTIA_SRC = `https://unpkg.com/@sveltia/cms@${SVELTIA_VERSION}/dist/sveltia-cms.js`;
  const SVELTIA_INTEGRITY =
    "sha384-de/3M+uPwFt49OFqCPX3PaI93kBil3RI4m0yXHFuvBIBQcAWDnH3FDZu6P8y7vEL";

  const notice = document.getElementById("cms-notice");
  const loading = document.getElementById("cms-loading");
  const notConfigured = document.getElementById("cms-not-configured");
  const openAnyway = document.getElementById("cms-open-anyway");

  let started = false;
  function startCms() {
    if (started) return;
    started = true;
    if (notConfigured) notConfigured.hidden = true;
    if (loading) {
      loading.hidden = false;
      loading.textContent = "Loading the content manager…";
    }
    window.CMS_MANUAL_INIT = true;
    const script = document.createElement("script");
    script.src = SVELTIA_SRC;
    script.integrity = SVELTIA_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.addEventListener("load", () => {
      notice?.remove();
      window.CMS.init({ config: { backend: { base_url: window.location.origin } } });
    });
    script.addEventListener("error", () => {
      started = false;
      if (loading) {
        loading.textContent =
          "The content manager couldn't be loaded. Check your connection and reload the page.";
      }
    });
    document.head.appendChild(script);
  }

  function showNotConfigured() {
    if (loading) loading.hidden = true;
    if (notConfigured) notConfigured.hidden = false;
    openAnyway?.addEventListener("click", startCms, { once: true });
  }

  fetch("/api/cms-oauth/status", { headers: { Accept: "application/json" }, cache: "no-store" })
    .then((response) => (response.ok ? response.json() : { configured: true }))
    .then((status) => (status && status.configured === false ? showNotConfigured() : startCms()))
    // If the check itself fails, load the editor: its own sign-in will report any problem.
    .catch(startCms);
})();
