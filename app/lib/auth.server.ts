import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, schema } from "../db";
import { telegram } from "./telegram-plugin.server";

/**
 * Logins are Telegram-only on purpose: password hashing (scrypt) exceeds the
 * Workers free-plan CPU limit, and members already live in Telegram.
 */
export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.PUBLIC_SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env.DB), {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "member", input: false },
        telegramId: { type: "string", required: false, input: false },
        telegramUsername: { type: "string", required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      // Saves a D1 read on most page loads
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    plugins: [telegram({ botToken: env.TELEGRAM_BOT_TOKEN })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
