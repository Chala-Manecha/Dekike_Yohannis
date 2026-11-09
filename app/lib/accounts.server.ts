/**
 * Users and how they sign in, using the Better Auth tables directly:
 *  - Telegram: an `account` row with providerId "telegram", accountId = Telegram user id
 *    (the id never changes, unlike the @username, which is kept on the user for display)
 *  - Website: an `account` row with providerId "password", holding the PBKDF2 hash
 * Members sign in on the website with their student ID (members.student_id → user).
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { studentIdKey } from "./registration";

export const TELEGRAM = "telegram";
export const PASSWORD = "password";

export type TgProfile = { id: number; name: string; username?: string | null; photoUrl?: string | null };

export async function userIdForTelegram(db: Db, telegramId: number) {
  const row = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, TELEGRAM), eq(schema.account.accountId, String(telegramId))),
    columns: { userId: true },
  });
  return row?.userId ?? null;
}

export async function telegramIdForUser(db: Db, userId: string) {
  const row = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, TELEGRAM), eq(schema.account.userId, userId)),
    columns: { accountId: true },
  });
  return row?.accountId ?? null;
}

/** Keeps the shown @username and photo current (people change them). */
export async function refreshTelegramProfile(db: Db, userId: string, tg: TgProfile) {
  await db
    .update(schema.user)
    .set({ telegramUsername: tg.username ?? null, ...(tg.photoUrl ? { image: tg.photoUrl } : {}) })
    .where(eq(schema.user.id, userId));
}

export async function createUser(db: Db, name: string, tg?: TgProfile) {
  const id = crypto.randomUUID();
  await db.insert(schema.user).values({
    id,
    name,
    // Better Auth needs an email; members don't use one
    email: tg ? `tg-${tg.id}@users.telegram.invalid` : `u-${id}@users.invalid`,
    image: tg?.photoUrl ?? null,
    telegramId: tg ? String(tg.id) : null,
    telegramUsername: tg?.username ?? null,
  });
  if (tg) await db.insert(schema.account).values({ id: crypto.randomUUID(), providerId: TELEGRAM, accountId: String(tg.id), userId: id });
  return id;
}

/** Telegram user → their user id, creating a user the first time. */
export async function userForTelegram(db: Db, tg: TgProfile) {
  const existing = await userIdForTelegram(db, tg.id);
  if (existing) {
    await refreshTelegramProfile(db, existing, tg);
    return existing;
  }
  return createUser(db, tg.name, tg);
}

export type LinkError = "telegram_taken" | "account_has_telegram";

/** Ties a Telegram account to an existing (website) user. One Telegram account per user and vice versa. */
export async function linkTelegram(db: Db, userId: string, tg: TgProfile): Promise<LinkError | null> {
  const owner = await userIdForTelegram(db, tg.id);
  if (owner === userId) return null;
  if (owner) return "telegram_taken";
  if (await telegramIdForUser(db, userId)) return "account_has_telegram";
  await db.insert(schema.account).values({ id: crypto.randomUUID(), providerId: TELEGRAM, accountId: String(tg.id), userId });
  await db
    .update(schema.user)
    .set({ telegramId: String(tg.id), telegramUsername: tg.username ?? null })
    .where(eq(schema.user.id, userId));
  return null;
}

export async function getPasswordHash(db: Db, userId: string) {
  const row = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, PASSWORD), eq(schema.account.userId, userId)),
    columns: { password: true },
  });
  return row?.password ?? null;
}

export async function setPasswordHash(db: Db, userId: string, hash: string) {
  const updated = await db
    .update(schema.account)
    .set({ password: hash })
    .where(and(eq(schema.account.providerId, PASSWORD), eq(schema.account.userId, userId)))
    .returning({ id: schema.account.id });
  if (updated.length === 0) {
    await db.insert(schema.account).values({ id: crypto.randomUUID(), providerId: PASSWORD, accountId: userId, userId, password: hash });
  }
}

export async function clearPassword(db: Db, userId: string) {
  await db.delete(schema.account).where(and(eq(schema.account.providerId, PASSWORD), eq(schema.account.userId, userId)));
}

export async function memberByStudentId(db: Db, studentId: string) {
  // Matched by key, so "UGR/1/12" finds a member registered as "ugr 1-12"
  return db.query.members.findFirst({ where: eq(schema.members.studentIdKey, studentIdKey(studentId)), columns: { id: true, userId: true } });
}
