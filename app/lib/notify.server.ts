import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { BOT_SEND_BATCH } from "../config";
import { getDb, schema, type Db } from "../db";
import { classInfo, duesFor } from "./classyear";
import { eatHour, todayIso } from "./dates";
import { defaultZikrIso, homeWindow, zikrMonthsToEnsure } from "./events";
import { toEth } from "./ethiopian";
import { planDaily, type OutboxItem, type PlanEvent, type PlanMember } from "./notify";
import { getDues, getSetting, setSetting } from "./settings.server";

/** Create the default zikr (30th) for this month and the next two, if missing. Rescheduled ones are left alone. */
export async function ensureZikrEvents(db: Db, now = new Date()) {
  const [a, b, c] = zikrMonthsToEnsure(toEth(now)).map((m) =>
    db.insert(schema.events).values({ type: "zikr", date: defaultZikrIso(m), dueYear: m.year, dueMonth: m.month }).onConflictDoNothing(),
  );
  await db.batch([a, b, c]);
}

/** Active members with what the planner needs: Telegram id, language, claimed months, current dues. */
export async function loadPlanMembers(db: Db, now = new Date()): Promise<PlanMember[]> {
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.fullName,
      lang: schema.members.lang,
      graduationYear: schema.members.graduationYear,
      graduationMonth: schema.members.graduationMonth,
      studyYear: schema.members.studyYear,
      registeredYear: schema.members.registeredYear,
      telegramId: schema.user.telegramId,
      botNotify: schema.user.botNotify,
    })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(eq(schema.members.status, "active"));

  const claims = await db
    .select({ memberId: schema.contributionMonths.memberId, y: schema.contributionMonths.ethYear, m: schema.contributionMonths.ethMonth })
    .from(schema.contributionMonths);
  const claimed = new Map<string, Set<number>>();
  for (const c of claims) {
    if (!claimed.has(c.memberId)) claimed.set(c.memberId, new Set());
    claimed.get(c.memberId)!.add(c.y * 100 + c.m);
  }

  const dues = await getDues(db);
  const today = toEth(now);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lang: r.lang,
    telegramId: r.botNotify ? r.telegramId : null,
    claimed: claimed.get(r.id) ?? new Set(),
    monthlyDue: duesFor(classInfo(r, today), dues),
  }));
}

export async function enqueue(db: Db, items: OutboxItem[]) {
  if (items.length === 0) return;
  // One statement per row (D1 caps bound parameters per statement); dedupe keys make repeats harmless.
  const stmts = items.map((i) => db.insert(schema.outbox).values(i).onConflictDoNothing({ target: schema.outbox.dedupeKey }));
  for (let i = 0; i < stmts.length; i += 50) {
    const chunk = stmts.slice(i, i + 50);
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
  }
}

export async function scheduledEvents(db: Db, from: string, to: string): Promise<PlanEvent[]> {
  return db
    .select({
      id: schema.events.id,
      type: schema.events.type,
      title: schema.events.title,
      date: schema.events.date,
      time: schema.events.time,
      place: schema.events.place,
      dueYear: schema.events.dueYear,
      dueMonth: schema.events.dueMonth,
    })
    .from(schema.events)
    .where(and(eq(schema.events.status, "scheduled"), gte(schema.events.date, from), lte(schema.events.date, to)))
    .orderBy(asc(schema.events.date));
}

/** Once a day (after 08:00 Addis): create zikr events, queue announcements and reminders. */
export async function runDailyPlan(env: Env, db: Db, now = new Date()) {
  const today = todayIso(now);
  await ensureZikrEvents(db, now);
  const { from, to } = homeWindow(today);
  const events = await scheduledEvents(db, from, to);
  const members = events.some((e) => e.type === "zikr") ? await loadPlanMembers(db, now) : [];
  const items = planDaily({
    today,
    events,
    members,
    groupChatId: env.TELEGRAM_GROUP_CHAT_ID || null,
    siteUrl: env.PUBLIC_SITE_URL,
  });
  await enqueue(db, items);
  return items.length;
}

type SendResult = { ok: true } | { ok: false; permanent: boolean; error: string };

async function sendTelegram(token: string, chatId: string, text: string): Promise<SendResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { description?: string };
    // 400/403: chat not found, bot blocked, never started — retrying won't help
    return { ok: false, permanent: res.status === 400 || res.status === 403, error: `${res.status} ${body.description ?? ""}`.trim() };
  } catch (e) {
    return { ok: false, permanent: false, error: String(e) };
  }
}

/** Send up to BOT_SEND_BATCH queued messages. */
export async function drainOutbox(env: Env, db: Db) {
  if (!env.TELEGRAM_BOT_TOKEN) return 0;
  const batch = await db
    .select()
    .from(schema.outbox)
    .where(eq(schema.outbox.status, "pending"))
    .orderBy(asc(schema.outbox.createdAt))
    .limit(BOT_SEND_BATCH);
  if (batch.length === 0) return 0;

  const updates = [];
  for (const item of batch) {
    const r = await sendTelegram(env.TELEGRAM_BOT_TOKEN, item.chatId, item.text);
    const attempts = item.attempts + 1;
    updates.push(
      db
        .update(schema.outbox)
        .set(
          r.ok
            ? { status: "sent", attempts, sentAt: new Date(), error: null }
            : { status: r.permanent || attempts >= 3 ? "failed" : "pending", attempts, error: r.error.slice(0, 300) },
        )
        .where(eq(schema.outbox.id, item.id)),
    );
  }
  await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
  return batch.length;
}

/** Cron entry point (every 30 minutes). */
export async function runCron(env: Env, now = new Date()) {
  const db = getDb(env.DB);
  const today = todayIso(now);
  if (eatHour(now) >= 8 && (await getSetting<string>(db, "lastPlanned")) !== today) {
    await runDailyPlan(env, db, now);
    await setSetting(db, "lastPlanned", today, null);
  }
  await drainOutbox(env, db);
  // Bot registrations left unfinished for a week, and old wrong-password counters
  await db.delete(schema.botRegistrations).where(lt(schema.botRegistrations.updatedAt, now.getTime() - 7 * 86_400_000));
  await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.windowStart, now.getTime() - 86_400_000));
}

