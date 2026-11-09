import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "../db";
import { botStartLink, LOGIN_COOKIE, LOGIN_TTL_MS, isLoginCode, newLoginCode, safeEqual } from "./bot-login";

const devBody = z.object({
  telegramId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(80),
});

const PROVIDER = "telegram";

type TgProfile = { id: number; name: string; username?: string; photoUrl?: string };

async function signInTelegramUser(ctx: any, tg: TgProfile) {
  const adapter = ctx.context.internalAdapter;
  const accountId = String(tg.id);
  const owner = await adapter.findAccountOwnerByKey({ providerId: PROVIDER, accountId });

  let user: User;
  if (owner?.kind === "owned") {
    user =
      (await adapter.updateUser(owner.user.id, {
        name: tg.name,
        image: tg.photoUrl ?? owner.user.image ?? null,
        telegramUsername: tg.username ?? null,
      })) ?? owner.user;
  } else if (owner?.kind === "orphaned") {
    throw new APIError("CONFLICT", { message: "Telegram account is in a broken state. Ask an admin." });
  } else {
    const created = await adapter.createOAuthUser(
      {
        name: tg.name,
        email: `tg-${tg.id}@users.telegram.invalid`,
        emailVerified: false,
        image: tg.photoUrl ?? null,
        telegramId: accountId,
        telegramUsername: tg.username ?? null,
      },
      { providerId: PROVIDER, accountId },
    );
    user = created.user;
  }

  const session = await adapter.createSession(user.id);
  if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not create session" });
  await setSessionCookie(ctx, { session, user });
}

type BotLoginRow = typeof schema.botLogins.$inferSelect;

export function telegram(opts: { db: Db; botUsername: string }) {
  const { db } = opts;
  const cookieOptions = {
    httpOnly: true,
    secure: !import.meta.env.DEV,
    sameSite: "lax" as const,
    path: "/",
    maxAge: LOGIN_TTL_MS / 1000,
  };
  const live = (code: string) => and(eq(schema.botLogins.code, code), gt(schema.botLogins.expiresAt, Date.now()));

  /**
   * Takes a confirmed code (once: deleted in the same statement) and signs in. If signing in
   * fails, the code is put back so the member can simply try again instead of starting over.
   */
  async function finishSignIn(ctx: any, row: BotLoginRow) {
    try {
      await signInTelegramUser(ctx, { id: Number(row.telegramId), name: row.name ?? "Telegram", username: row.username ?? undefined });
    } catch (e) {
      console.error("bot-login: sign-in failed", e);
      await db.insert(schema.botLogins).values(row).onConflictDoNothing();
      throw e;
    }
    ctx.setCookie(LOGIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  }

  async function claimConfirmed(code: string) {
    const [row] = await db
      .delete(schema.botLogins)
      .where(and(live(code), eq(schema.botLogins.status, "confirmed")))
      .returning();
    return row;
  }

  return {
    id: "telegram",
    endpoints: {
      // Step 1 (app/lib/bot-login.ts): a one-time code for this browser. If the page is
      // reloaded (common when switching to Telegram and back) the same code is reused.
      botLoginStart: createAuthEndpoint("/bot-login/start", { method: "POST" }, async (ctx) => {
        const existing = ctx.getCookie(LOGIN_COOKIE);
        if (isLoginCode(existing)) {
          const row = await db.query.botLogins.findFirst({ where: live(existing) });
          if (row && row.expiresAt - Date.now() > 60_000) {
            return ctx.json({ url: botStartLink(opts.botUsername, row.code), confirmed: row.status === "confirmed" });
          }
        }
        const code = newLoginCode();
        const now = Date.now();
        await db.insert(schema.botLogins).values({ code, expiresAt: now + LOGIN_TTL_MS, createdAt: now });
        ctx.setCookie(LOGIN_COOKIE, code, cookieOptions);
        return ctx.json({ url: botStartLink(opts.botUsername, code), confirmed: false });
      }),

      // Step 4: the browser holding the cookie asks whether the member confirmed in the bot.
      botLoginPoll: createAuthEndpoint("/bot-login/poll", { method: "POST" }, async (ctx) => {
        const code = ctx.getCookie(LOGIN_COOKIE);
        if (!isLoginCode(code)) return ctx.json({ status: "expired" as const });
        const row = await claimConfirmed(code);
        if (!row) {
          const pending = await db.query.botLogins.findFirst({ where: live(code), columns: { code: true } });
          return ctx.json({ status: pending ? ("pending" as const) : ("expired" as const) });
        }
        await finishSignIn(ctx, row);
        return ctx.json({ ok: true });
      }),

      // From the bot's "open the website" button: signs in whichever browser opens it.
      // The secret part (k) is only ever sent in the member's own bot chat.
      botLoginClaim: createAuthEndpoint(
        "/bot-login/claim",
        { method: "GET", query: z.object({ c: z.string(), k: z.string() }) },
        async (ctx) => {
          const { c, k } = ctx.query;
          const row = isLoginCode(c) ? await db.query.botLogins.findFirst({ where: and(live(c), eq(schema.botLogins.status, "confirmed")) }) : undefined;
          if (!row || !safeEqual(row.claim, k)) throw ctx.redirect("/login?expired=1");
          const claimed = await claimConfirmed(row.code);
          if (!claimed) throw ctx.redirect("/me"); // the waiting browser was quicker
          await finishSignIn(ctx, claimed);
          throw ctx.redirect("/me");
        },
      ),

      // Telegram can't reach localhost. This endpoint exists only in `npm run dev`:
      // import.meta.env.DEV is replaced with `false` in production builds.
      signInDev: createAuthEndpoint("/sign-in/dev", { method: "POST", body: devBody }, async (ctx) => {
        if (!import.meta.env.DEV) throw new APIError("NOT_FOUND");
        await signInTelegramUser(ctx, { id: ctx.body.telegramId, name: ctx.body.name });
        return ctx.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}
