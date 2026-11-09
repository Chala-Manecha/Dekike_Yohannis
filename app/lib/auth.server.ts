import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, schema } from "../db";
import { telegram } from "./telegram-plugin.server";

/**
 * Logins are Telegram-only on purpose: password hashing (scrypt) exceeds the
 * Workers free-plan CPU limit, and members already live in Telegram.
 */
export function createAuth(env: Env) {
  const db = getDb(env.DB);
  return betterAuth({
    baseURL: env.PUBLIC_SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
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
      // Signed out after 30 days without a visit; each day with a visit pushes it 30 days on.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Saves a D1 read on most page loads
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    plugins: [telegram({ db, botUsername: env.TELEGRAM_BOT_USERNAME })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
