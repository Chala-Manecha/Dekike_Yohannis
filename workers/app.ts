import { createRequestHandler } from "react-router";
import { runCron } from "../app/lib/notify.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },

  // Every 30 minutes: once a day after 08:00 Addis it plans zikr events, announcements
  // and payment reminders; every run sends up to 40 queued Telegram messages.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Env>;
