# Toilet Map Client

This package hosts the frontend worker for the Toilet Map project. It is currently a placeholder worker that returns a simple HTML page so we can wire up routing, deployment, and CI independently from the API worker.

## Commands

```bash
pnpm --filter toiletmap-client dev     # Start wrangler dev server
pnpm --filter toiletmap-client build   # Build the worker bundle
pnpm --filter toiletmap-client deploy  # Deploy using wrangler
```

Replace `src/index.ts` with your UI or static asset pipeline when you're ready to build the frontend experience.
