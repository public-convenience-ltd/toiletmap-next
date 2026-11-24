import { createApp } from "./app";
import { handleScheduled } from "./services/export";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = createApp(env);
    return await app.fetch(request, env, ctx);
  },

  /**
   * Cron Triggers (production only, see wrangler.jsonc): publishes the daily
   * dataset export to the EXPORTS R2 bucket. The run is both handed to
   * `waitUntil` and awaited, so the invocation lasts until it finishes and a
   * failure marks the cron run as failed.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const run = handleScheduled(controller, env);
    ctx.waitUntil(run);
    await run;
  },
} satisfies ExportedHandler<Env>;
