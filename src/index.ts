import { createApp } from './app';
import type { Env } from './types';

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        const app = createApp(env);
        return app.fetch(request, env, ctx);
    },
};