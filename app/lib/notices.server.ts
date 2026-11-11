import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import type { Lang } from "./lang";
import type { OutboxItem } from "./notify";
import { drainOutbox, enqueue } from "./notify.server";
import type { Recipient } from "./notices";
import type { Role } from "./permissions";

/** Users with these roles who can get Telegram messages, in their own language. */
export async function recipientsWithRoles(db: Db, roles: Role[]): Promise<Recipient[]> {
  const rows = await db
    .select({ userId: schema.user.id, telegramId: schema.user.telegramId, lang: schema.members.lang })
    .from(schema.user)
    .leftJoin(schema.members, eq(schema.members.userId, schema.user.id))
    .where(and(inArray(schema.user.role, roles), isNotNull(schema.user.telegramId), eq(schema.user.botNotify, true)));
  return rows.map((r) => ({ userId: r.userId, telegramId: r.telegramId, lang: (r.lang ?? "om") as Lang }));
}

export async function recipientForUser(db: Db, userId: string): Promise<Recipient> {
  const row = await db
    .select({ userId: schema.user.id, telegramId: schema.user.telegramId, lang: schema.members.lang, botNotify: schema.user.botNotify })
    .from(schema.user)
    .leftJoin(schema.members, eq(schema.members.userId, schema.user.id))
    .where(eq(schema.user.id, userId))
    .get();
  // Members who turned bot messages off get nothing private (group posts still happen).
  return { userId, telegramId: row?.botNotify ? (row.telegramId ?? null) : null, lang: (row?.lang ?? "om") as Lang };
}

/**
 * Queue the messages and send them right away in the background (the 30-minute cron is the
 * safety net if Telegram is slow or down). Never fails the request that triggered it.
 */
export function notify(env: Env, ctx: ExecutionContext, items: OutboxItem[]) {
  if (items.length === 0) return;
  const db = getDb(env.DB);
  ctx.waitUntil(
    enqueue(db, items)
      .then(() => drainOutbox(env, db))
      .catch((e) => console.error("notify failed", e)),
  );
}
