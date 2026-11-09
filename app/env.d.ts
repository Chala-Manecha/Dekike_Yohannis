/**
 * Worker secrets (set in Cloudflare: Settings → Variables and Secrets, type Secret).
 * Declared here so `npm run typecheck` works without a local .dev.vars file.
 */
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string;
    TELEGRAM_BOT_TOKEN: string;
    TURNSTILE_SECRET_KEY: string;
    TELEGRAM_WEBHOOK_SECRET: string;
  }
}
interface Env {
  BETTER_AUTH_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TURNSTILE_SECRET_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}
