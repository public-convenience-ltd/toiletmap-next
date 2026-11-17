/**
 * Minimal stand-in for the `cloudflare:workers` runtime module, used only by
 * vitest (see vitest.config.ts) so the built worker in dist/ can be imported in
 * Node for the SSR smoke test. Tests mutate `env` to provide bindings.
 */
export const env: Record<string, unknown> = {};

export class DurableObject {}
export class WorkerEntrypoint {}
export class WorkflowEntrypoint {}
