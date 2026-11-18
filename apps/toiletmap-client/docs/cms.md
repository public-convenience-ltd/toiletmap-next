# Content: pages, the blog and the CMS

The site's text pages and blog posts are Markdown files in this repository. Edit them in git,
or in the browser at **`/cms`** (Sveltia CMS), which commits the same files through GitHub.

## Where things live

| What | Files | URL |
| --- | --- | --- |
| Text pages | `src/content/pages/<id>.md` | `/<id>`: `/about`, `/contact`, `/privacy`, `/app`, `/app/privacy` |
| Blog posts | `src/content/posts/<slug>.md` | `/posts/<slug>` (the legacy site's slugs) |
| Blog index | (generated) | `/posts`, then `/posts/page/2`, ... once there are more than 20 posts |
| RSS | (generated) | `/posts/rss.xml` |
| Images and files | `public/images/uploads/` | `/images/uploads/<file>` (the legacy URLs) |
| PDFs from the About page | `public/*.pdf` | `/Toilet.Map.Volunteer.Help.Guide.pdf`, `/GBPTM.Toilet.Checklist.pdf` |
| CMS | `public/cms/` (`index.html`, `cms-loader.js`, `config.yml`) | `/cms/` |
| CMS sign-in | `src/pages/api/cms-oauth/{auth,callback,status}.ts`, `src/utils/cmsOAuth.ts` | `/api/cms-oauth/*` |

- Front matter is checked against `src/utils/contentSchemas.ts` at build time, and by
  `src/content.test.ts` in `pnpm test`.
  - **Posts:** `title`, `date`, and optionally `description`, `authors` (`name`, `social_url`,
    `profile_image_url`), `image` and `draft`.
  - **Pages:** `title` (for the browser tab), and optionally `heading` (the `<h1>`, which
    defaults to the title) and `description`.
- `/app/privacy` is the Android app's privacy policy, linked from its Google Play listing.
  Its URL must not change. The build writes `app/privacy.html` (astro.config
  `build.format: "file"`), so it is served at exactly `/app/privacy`, with no
  trailing-slash redirect.
- All of these pages are prerendered. The header works out whether the visitor is signed in
  from the browser (`SiteHeader`), so a prerendered page never has anyone's signed-in state
  baked into it.
- A new page file appears at `/<id>` on the next deploy (`src/pages/[...slug].astro`). The CMS
  only edits the five existing pages; add a new one in git and list it in `config.yml`.

### Differences from the legacy pages

The pages were ported word for word, apart from these (recorded so nobody hunts for them):

- **About:** the legacy page ended with "The Explorer" and a "Visit the Explorer" link. It is
  left out until `/explorer` exists again (Phase 7, with the other legacy redirects). The two
  PDF downloads were buttons; they are ordinary links in the Markdown now (same files).
- **Contact:** one new sentence linking the feedback form.
- **Privacy pages:** same wording. Astro's smartypants turns straight quotes and apostrophes
  into curly ones (`"App"` becomes “App”), and `/app/privacy`'s "Last updated" line is a
  normal first paragraph rather than a subtitle. Set `markdown.smartypants: false` in
  astro.config if a byte-exact copy is ever needed (it also affects posts).
- **Footer:** links to `/dataset`, the dataset page Phase 6 adds.

## The CMS

[Sveltia CMS](https://sveltiacms.app/) is a single-page app loaded from a CDN. It is not an npm
dependency.

- **Version:** `public/cms/cms-loader.js` pins the version (`SVELTIA_VERSION`) and checks the
  file against its Subresource Integrity hash (`SVELTIA_INTEGRITY`).
- **Repository:** it edits `public-convenience-ltd/toiletmap-next` on `main`.
- **Editorial workflow:** this is on (`publish_mode: editorial_workflow`).
  - Every change becomes a pull request with a preview deployment.
  - Publishing an entry merges its pull request, and the merge deploys the site
    (`.github/workflows/deploy-production.yml`).
  - Sveltia supports this with the GitHub backend.
- **Search engines:** `/cms` is noindex in three ways: the page's robots meta tag,
  the `X-Robots-Tag` header (generated into `_headers` at build time, see
  [security.md](security.md)), and `Disallow: /cms` in robots.txt. It is not in the
  sitemap.
- **Developing locally:** open `http://localhost:4321/cms/index.html`. The dev server may not
  map `/cms/` to the folder's `index.html`, but the deployed site does.

### Signing in with GitHub

Editors sign in with GitHub. Our own worker runs the OAuth flow, so no third-party
authenticator is involved:

1. The CMS opens a popup at `/api/cms-oauth/auth`. The worker stores a random `state` in a
   10-minute httpOnly cookie, then redirects to GitHub (scope `public_repo`, because the
   repository is public).
2. GitHub sends the editor back to `/api/cms-oauth/callback`. The worker:
   - checks the state;
   - exchanges the code for a token using the client secret, which never leaves the worker;
   - replies with a page that passes the token to the CMS window using `postMessage`.
3. Every message is sent to this site's own origin, never `"*"` (the legacy site used `"*"`).
   The popup only answers the CMS window that opened it, and only on this origin.

These routes are static Astro routes, so they take priority over the generic `/api/*` proxy.

Until the GitHub OAuth app is set up:

- `/api/cms-oauth/auth` and `/api/cms-oauth/callback` return **503 "CMS sign-in isn't
  configured yet"**.
- `/cms/` shows the same message, with a button to open the editor anyway. From there an
  editor can sign in with a GitHub personal access token, or work on a local copy of the
  repository in Chrome or Edge.

### Setting up GitHub sign-in (owner, once)

1. **Create the OAuth app.** In GitHub, go to **public-convenience-ltd** → Settings →
   Developer settings → OAuth Apps → **New OAuth App**. A personal account's Developer
   settings also works.
   - **Application name:** `Toilet Map CMS`
   - **Homepage URL:** `https://www.toiletmap.org.uk`
   - **Authorization callback URL:** `https://www.toiletmap.org.uk/api/cms-oauth/callback`
   - Leave **Enable Device Flow** off.

   Use the origin editors will open `/cms` on. If the new site is still on
   `https://toiletmap-client.gbtoiletmap.workers.dev` before the domain moves, use that
   origin for the callback URL. Change it when the domain moves. The CMS always signs in
   through the origin it was opened on.
2. **Generate a client secret.** Click **Generate a new client secret** and copy it. GitHub
   shows it only once.
3. **Set both values on the production client worker** as secrets. Secrets survive deploys;
   values set as dashboard vars do not.

   ```sh
   cd apps/toiletmap-client
   pnpm exec wrangler secret put GITHUB_OAUTH_CLIENT_ID --env production
   pnpm exec wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --env production
   ```

   You can also set them in the Cloudflare dashboard: Workers → `toiletmap-client` →
   Settings → Variables and Secrets, both of type **Secret**. They take effect at once; no
   deploy is needed.
4. **Check it.** Open `https://www.toiletmap.org.uk/cms/`, choose **Sign in with GitHub** and
   approve the app. Editors need write access to the repository.

#### Previews and local development

- **Previews:** preview deployments run on other origins, which GitHub won't redirect to.
  There, sign in with a personal access token instead, or set up a second OAuth app.
- **Local development:**
  1. Create a separate OAuth app with the callback URL
     `http://localhost:4321/api/cms-oauth/callback`.
  2. Put its values in `apps/toiletmap-client/.dev.vars`, which is gitignored:

     ```
     GITHUB_OAUTH_CLIENT_ID=...
     GITHUB_OAUTH_CLIENT_SECRET=...
     ```

### Upgrading Sveltia CMS

1. **Pick a version** published at least two weeks ago: `npm view @sveltia/cms time --json`.
2. **Print its integrity hash:**

   ```sh
   curl -sSL https://unpkg.com/@sveltia/cms@<version>/dist/sveltia-cms.js \
     | openssl dgst -sha384 -binary | openssl base64 -A
   ```

3. **Update the loader and the CSP.** In `public/cms/cms-loader.js`, set `SVELTIA_VERSION`,
   and set `SVELTIA_INTEGRITY` to `sha384-<hash>`. Set the same version in
   `SVELTIA_CMS_VERSION` (`src/utils/securityHeaders.ts`): the `/cms` CSP only allows scripts
   from that exact package path on unpkg.
4. **Test it.** Run `pnpm test`; `src/cms.test.ts` checks the pin, that the CSP allows the
   same version, and the config. Then try `/cms/` locally.
