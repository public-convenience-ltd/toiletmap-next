# Analytics (Plausible)

The client can count pageviews with [Plausible](https://plausible.io), a cookieless
analytics service. It is **off** unless the `PLAUSIBLE_DOMAIN` var is set, and off in every
environment today.

## Turning it on

1. Add the site in Plausible (this needs a Plausible account; Plausible is a paid service,
   with a free trial). Its "domain" is the name you will put in `PLAUSIBLE_DOMAIN`, e.g.
   `toiletmap.org.uk`.
2. Set the var in `wrangler.jsonc`, under `env.production.vars`:

   ```jsonc
   "PLAUSIBLE_DOMAIN": "toiletmap.org.uk"
   ```

   It is a plain var, not a secret. Set it in the file rather than the Cloudflare dashboard:
   every deploy replaces dashboard vars with the file's.
3. Merge to `main` (the production deploy runs automatically) and publish the privacy policy
   wording below.

To try it locally, put `PLAUSIBLE_DOMAIN=…` in `.dev.vars`. (Plausible's script ignores
`localhost`, so nothing is counted from a dev machine.) To turn it off, remove the var or
set it to `""`.

## How it works

Everything goes through our own origin (a first-party proxy, as in Plausible's
[proxy guide](https://plausible.io/docs/proxy/introduction)), so the browser never contacts
plausible.io and ad blockers' third-party lists don't apply. The code is in
[src/utils/plausible.ts](../src/utils/plausible.ts).

- **Script tag.** [src/components/Analytics.astro](../src/components/Analytics.astro), in
  `<head>` of every page (src/layouts/BaseLayout.astro), renders
  `<script defer data-domain="…" data-api="/api/event" src="/js/p.js"></script>`.
  With `PLAUSIBLE_DOMAIN` unset it renders nothing at all.
- **`GET /js/p.js`** ([src/pages/js/p.js.ts](../src/pages/js/p.js.ts)) serves Plausible's
  standard `https://plausible.io/js/script.js` (pageviews only), cached for 6 hours in the
  Workers edge cache and the browser.
- **`POST /api/event`** ([src/pages/api/event.ts](../src/pages/api/event.ts)) forwards the
  event to `https://plausible.io/api/event` with only `Content-Type`, the visitor's
  `User-Agent` and `X-Forwarded-For` set to the visitor's IP (from `cf-connecting-ip`; the
  browser's own `X-Forwarded-For` is ignored). Plausible needs the IP and User-Agent to count
  unique visitors. Cookies, `Referer` and all other headers are dropped. The route only
  accepts small same-origin POSTs for our own domain, so it can't relay events for other
  sites. It is a static route, so Astro routes it ahead of the generic `/api/[...path]`
  proxy (which doesn't allow `/api/event` anyway).
- Both routes are a plain 404 while `PLAUSIBLE_DOMAIN` is unset.

Not tracked:

- `/cms`, `/dev/*`, `/auth/*`, `/admin`, and the contribution forms (`/loos/add`,
  `/loos/:id/edit`, `/loos/:id/remove`, `/loos/:id/report`): pages where people sign in or
  enter data. The list is `UNTRACKED_PATH_PATTERNS` in `src/utils/plausible.ts`.
- Visitors whose browser sends **Global Privacy Control** (`Sec-GPC: 1`) or **Do Not Track**
  (`DNT: 1`): the script tag is left out of their pages, and `/api/event` drops (202, not
  forwarded) any event they send anyway, e.g. from a cached or prerendered page.

When a client Content-Security-Policy is added, `script-src 'self'` and `connect-src 'self'`
already cover both routes; no Plausible host is needed.

## Privacy policy wording

Add something like this to the privacy policy before turning analytics on:

> **Analytics.** We use Plausible Analytics to count visits to the Toilet Map and see which
> pages are used, so we can improve the site. Plausible does not use cookies or store
> anything on your device, and does not track you across other websites. When you load a
> page, our server passes Plausible the page address, the address of the site that linked
> you to us (if any), your browser's user-agent string, your screen width and your IP
> address. Plausible uses your IP address and user agent only to work out your country and
> to count unique visitors, through a code that changes every day, and does not store
> either. We do not count visits to the pages for adding, editing or reporting toilets, or
> to sign-in pages, and we don't count you at all if your browser sends Global Privacy
> Control or Do Not Track. Plausible is run by Plausible Insights OÜ in the EU and keeps
> its data in the EU. See [Plausible's data policy](https://plausible.io/data-policy).

This is a draft: check the details against Plausible's current data policy before
publishing. Plausible sets no cookies and stores nothing on the device, which is why it is
commonly run without a cookie consent banner; whether the site needs one is a call for
whoever owns the privacy policy (the lawful basis would normally be legitimate interests:
understanding how the site is used).
