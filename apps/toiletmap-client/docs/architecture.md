# Toilet Map Client Architecture

The `toiletmap-client` is a modern web application built with [Astro](https://astro.build/).

## Key Technologies

- **Framework**: Astro (SSR mode)
- **UI Library**: Preact (via Astro Islands)
- **Styling**: CSS Modules (scoped styling)
- **Deployment**: Cloudflare Workers (via `@astrojs/cloudflare` adapter)

## Rendering Strategy

The application uses Server-Side Rendering (SSR) by default (`output: 'server'`).
Interactive components are hydrated on the client using Astro's [Island Architecture](https://docs.astro.build/en/concepts/islands/).

### Hydration Directives
- Use `client:load` for components that need to be interactive immediately.
- Use `client:visible` for components that are lower down the page.
- Use `client:idle` for low-priority interactivity.

## Project Structure

- `src/pages`: File-based routing. `.astro` files here become routes.
- `src/components`: Reusable UI components (`.astro`, `.jsx`, `.tsx`).
- `src/layouts`: Page layouts.
- `public`: Static assets.

## Deployment

The app is built into a Cloudflare Worker.
- Build command: `pnpm run build` (runs `astro build`)
- Deploy command: `pnpm run deploy` (runs `wrangler deploy`)
