import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { verifyTelegramLogin, type TelegramLoginData } from "./telegram-verify";

// looseObject: every field Telegram sends is part of the signature, so unknown
// fields must be kept, not stripped.
const telegramBody = z.looseObject({
  id: z.coerce.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().url().optional(),
  auth_date: z.coerce.number().int(),
  hash: z.string().regex(/^[a-f0-9]{64}$/i),
});

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

export function telegram(opts: { botToken: string }) {
  return {
    id: "telegram",
    endpoints: {
      signInTelegram: createAuthEndpoint(
        "/sign-in/telegram",
        { method: "POST", body: telegramBody },
        async (ctx) => {
          const data = ctx.body as TelegramLoginData;
          const result = await verifyTelegramLogin(data, opts.botToken, Date.now());
          if (!result.ok) {
            throw new APIError("UNAUTHORIZED", {
              message: result.reason === "expired" ? "Telegram login expired. Try again." : "Telegram login could not be verified.",
            });
          }
          const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
          return signInTelegramUser(ctx, {
            id: data.id,
            name,
            username: data.username,
            photoUrl: data.photo_url,
          });
        },
      ),

      // Telegram's widget does not run on localhost. This endpoint exists only in
      // `npm run dev`: import.meta.env.DEV is replaced with `false` in production builds.
      signInDev: createAuthEndpoint("/sign-in/dev", { method: "POST", body: devBody }, async (ctx) => {
        if (!import.meta.env.DEV) throw new APIError("NOT_FOUND");
        return signInTelegramUser(ctx, { id: ctx.body.telegramId, name: ctx.body.name });
      }),
    },
  } satisfies BetterAuthPlugin;
}
