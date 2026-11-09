import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "../db";
import { getPasswordHash, linkTelegram, memberByStudentId, refreshTelegramProfile, userForTelegram, userIdForTelegram, type TgProfile } from "./accounts.server";
import { telegramName } from "./bot-login";
import { afterFailure, isLocked } from "./login-limit";
import { hashPassword, verifyPassword } from "./password";
import { studentIdSchema } from "./registration";
import { verifyWebAppInitData } from "./telegram-webapp";

/**
 * How members sign in (all checks on the server):
 *  - /student-login: student ID + password (the website)
 *  - /telegram-webapp: inside the Telegram mini app, automatic for a linked Telegram account
 *  - /telegram-link: first time in the mini app, ties Telegram to an existing website account
 */

const devBody = z.object({ telegramId: z.coerce.number().int().positive(), name: z.string().min(1).max(80) });
const credentials = z.object({ studentId: z.string().max(40), password: z.string().max(128) });

async function startSession(ctx: any, userId: string) {
  const adapter = ctx.context.internalAdapter;
  const user = await adapter.findUserById(userId);
  if (!user) throw new APIError("INTERNAL_SERVER_ERROR", { message: "User missing" });
  const session = await adapter.createSession(user.id);
  if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not create session" });
  await setSessionCookie(ctx, { session, user });
}

export function telegram(opts: { db: Db; botToken: string }) {
  const { db } = opts;
  // Used when the student ID doesn't exist, so a wrong ID takes as long as a wrong password
  const dummyHash = hashPassword("not-a-real-password");

  /** Student ID + password → user id, with the wrong-password lockout. Throws a generic error. */
  async function checkCredentials(rawId: string, password: string) {
    const parsed = studentIdSchema.safeParse(rawId);
    const studentId = parsed.success ? parsed.data : rawId.trim().toUpperCase();
    const key = `sid:${studentId}`;
    const now = Date.now();
    const attempts = await db.query.loginAttempts.findFirst({ where: eq(schema.loginAttempts.key, key) });
    if (isLocked(attempts, now)) throw new APIError("TOO_MANY_REQUESTS", { message: "locked" });

    const member = parsed.success ? await memberByStudentId(db, studentId) : undefined;
    const hash = member ? await getPasswordHash(db, member.userId) : null;
    const ok = await verifyPassword(password, hash ?? (await dummyHash));
    if (!member || !hash || !ok) {
      const next = afterFailure(attempts, now);
      await db.insert(schema.loginAttempts).values({ key, ...next }).onConflictDoUpdate({ target: schema.loginAttempts.key, set: next });
      throw new APIError("UNAUTHORIZED", { message: "bad_credentials" });
    }
    if (attempts) await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.key, key));
    return member.userId;
  }

  async function telegramFrom(initData: string): Promise<TgProfile> {
    const result = await verifyWebAppInitData(initData, opts.botToken, Date.now());
    if (!result.ok) throw new APIError("UNAUTHORIZED", { message: result.reason });
    const u = result.user;
    return { id: u.id, name: telegramName(u), username: u.username ?? null, photoUrl: u.photo_url ?? null };
  }

  return {
    id: "telegram",
    endpoints: {
      studentLogin: createAuthEndpoint("/student-login", { method: "POST", body: credentials }, async (ctx) => {
        const userId = await checkCredentials(ctx.body.studentId, ctx.body.password);
        await startSession(ctx, userId);
        return ctx.json({ ok: true });
      }),

      // Inside the mini app. Linked Telegram account → signed in. Otherwise the app shows
      // the "link or register" page; create=true makes a new account for registering.
      telegramWebApp: createAuthEndpoint(
        "/telegram-webapp",
        { method: "POST", body: z.object({ initData: z.string().min(1).max(4096), create: z.boolean().optional() }) },
        async (ctx) => {
          const tg = await telegramFrom(ctx.body.initData);
          let userId = await userIdForTelegram(db, tg.id);
          if (userId) await refreshTelegramProfile(db, userId, tg);
          else if (ctx.body.create) userId = await userForTelegram(db, tg);
          else return ctx.json({ ok: false, linked: false });
          await startSession(ctx, userId);
          return ctx.json({ ok: true });
        },
      ),

      telegramLink: createAuthEndpoint(
        "/telegram-link",
        { method: "POST", body: credentials.extend({ initData: z.string().min(1).max(4096) }) },
        async (ctx) => {
          const tg = await telegramFrom(ctx.body.initData);
          const userId = await checkCredentials(ctx.body.studentId, ctx.body.password);
          const error = await linkTelegram(db, userId, tg);
          if (error) throw new APIError("CONFLICT", { message: error });
          await startSession(ctx, userId);
          return ctx.json({ ok: true });
        },
      ),

      // Local development only: import.meta.env.DEV is replaced with `false` in production builds.
      signInDev: createAuthEndpoint("/sign-in/dev", { method: "POST", body: devBody }, async (ctx) => {
        if (!import.meta.env.DEV) throw new APIError("NOT_FOUND");
        const userId = await userForTelegram(db, { id: ctx.body.telegramId, name: ctx.body.name });
        await startSession(ctx, userId);
        return ctx.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}
