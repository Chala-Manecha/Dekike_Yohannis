import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "../db";
import { botStartLink, LOGIN_COOKIE, LOGIN_TTL_MS, isLoginCode, newLoginCode } from "./bot-login";

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
  return ctx.json({ ok: true });
}

export function telegram(opts: { db: Db; botUsername: string }) {
  const { db } = opts;
  const cookieOptions = {
    httpOnly: true,
    secure: !import.meta.env.DEV,
    sameSite: "lax" as const,
    path: "/",
    maxAge: LOGIN_TTL_MS / 1000,
  };

  return {
    id: "telegram",
    endpoints: {
      // Step 1 (app/lib/bot-login.ts): a fresh one-time code for this browser.
      botLoginStart: createAuthEndpoint("/bot-login/start", { method: "POST" }, async (ctx) => {
        const code = newLoginCode();
        const now = Date.now();
        await db.insert(schema.botLogins).values({ code, expiresAt: now + LOGIN_TTL_MS, createdAt: now });
        ctx.setCookie(LOGIN_COOKIE, code, cookieOptions);
        return ctx.json({ url: botStartLink(opts.botUsername, code), expiresIn: LOGIN_TTL_MS });
      }),

      // Step 4: the browser that holds the cookie asks whether the member confirmed in the bot.
      botLoginPoll: createAuthEndpoint("/bot-login/poll", { method: "POST" }, async (ctx) => {
        const code = ctx.getCookie(LOGIN_COOKIE);
        if (!isLoginCode(code)) return ctx.json({ status: "expired" as const });
        // Claim it in one statement so a code can only ever sign in once
        const [row] = await db
          .delete(schema.botLogins)
          .where(and(eq(schema.botLogins.code, code), eq(schema.botLogins.status, "confirmed"), gt(schema.botLogins.expiresAt, Date.now())))
          .returning();
        if (!row) {
          const pending = await db.query.botLogins.findFirst({
            where: and(eq(schema.botLogins.code, code), gt(schema.botLogins.expiresAt, Date.now())),
            columns: { code: true },
          });
          return ctx.json({ status: pending ? ("pending" as const) : ("expired" as const) });
        }
        ctx.setCookie(LOGIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
        return signInTelegramUser(ctx, { id: Number(row.telegramId), name: row.name ?? "Telegram", username: row.username ?? undefined });
      }),

      // Telegram can't reach localhost. This endpoint exists only in `npm run dev`:
      // import.meta.env.DEV is replaced with `false` in production builds.
      signInDev: createAuthEndpoint("/sign-in/dev", { method: "POST", body: devBody }, async (ctx) => {
        if (!import.meta.env.DEV) throw new APIError("NOT_FOUND");
        return signInTelegramUser(ctx, { id: ctx.body.telegramId, name: ctx.body.name });
      }),
    },
  } satisfies BetterAuthPlugin;
}
