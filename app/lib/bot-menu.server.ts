import { and, asc, count as countRows, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { schema, type Db } from "../db";
import { classInfo, duesFor } from "./classyear";
import { payableMonths } from "./contributions";
import { daysBetween, isoToEth, todayIso } from "./dates";
import { monthPayRows } from "./finance.server";
import { currentDueMonth, monthKey, toEth } from "./ethiopian";
import { formatEth, t } from "./i18n";
import type { Lang } from "./lang";
import { DUTIES, eventTitle, MAX_PER_DUTY, when } from "./notify";
import { getDues } from "./settings.server";

type Member = typeof schema.members.$inferSelect;
export type BotReply = { text: string; reply_markup?: unknown };

const webApp = (text: string, url: string) => ({ text, web_app: { url } });

async function nextEvent(db: Db) {
  return db.query.events.findFirst({
    where: and(gte(schema.events.date, todayIso()), eq(schema.events.status, "scheduled")),
    orderBy: (e, { asc: a }) => [a(e.date)],
  });
}

/** Date, place, every duty with names, and the member's own duty. */
export async function nextReply(db: Db, member: Member, lang: Lang): Promise<BotReply> {
  const tr = t(lang);
  const e = await nextEvent(db);
  if (!e) return { text: tr.botMenu.nextNone };
  const duties = await db
    .select({ duty: schema.eventDuties.duty, memberId: schema.members.id, name: schema.members.fullName })
    .from(schema.eventDuties)
    .innerJoin(schema.members, eq(schema.members.id, schema.eventDuties.memberId))
    .where(eq(schema.eventDuties.eventId, e.id))
    .orderBy(asc(schema.eventDuties.createdAt));
  const lines = [`📅 ${eventTitle(lang, e)}`, when(lang, e)];
  const mine = duties.filter((d) => d.memberId === member.id).map((d) => tr.events.dutyNames[d.duty]);
  if (mine.length) lines.push("", tr.bot.yourDuty(mine.join(", ")));
  lines.push("");
  if (duties.length === 0) lines.push(tr.botMenu.noDuties);
  else {
    lines.push(tr.bot.dutiesHeader);
    for (const d of DUTIES) {
      const names = duties.filter((x) => x.duty === d).map((x) => x.name);
      if (names.length) lines.push(`• ${tr.events.dutyNames[d]}: ${names.join(", ")}`);
    }
  }
  return { text: lines.join("\n") };
}

/** Songs chosen for the next event; each button opens its lyrics. */
export async function songsReply(db: Db, lang: Lang, site: string): Promise<BotReply> {
  const tr = t(lang);
  const e = await nextEvent(db);
  if (!e) return { text: tr.botMenu.nextNone };
  const songs = await db
    .select({ id: schema.songs.id, title: schema.songs.title })
    .from(schema.eventSongs)
    .innerJoin(schema.songs, eq(schema.songs.id, schema.eventSongs.songId))
    .where(eq(schema.eventSongs.eventId, e.id))
    .orderBy(asc(schema.eventSongs.sort));
  if (songs.length === 0) return { text: tr.botMenu.noSongs, reply_markup: { inline_keyboard: [[webApp(tr.botMenu.songsPage, `${site}/songs`)]] } };
  return {
    text: `${tr.botMenu.songsTitle(eventTitle(lang, e))}\n\n${songs.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}`,
    reply_markup: { inline_keyboard: songs.slice(0, 12).map((s, i) => [webApp(`${i + 1}. ${s.title}`, `${site}/songs/${s.id}`)]) },
  };
}

/** This month and the six before it: paid / waiting for review / not paid. */
export async function payReply(db: Db, member: Member, lang: Lang, site: string): Promise<BotReply> {
  const tr = t(lang);
  if (member.status !== "active") return { text: tr.botMenu.notApproved };
  const today = toEth(new Date());
  const rate = duesFor(classInfo(member, today), await getDues(db));
  const current = currentDueMonth(today);
  const months = payableMonths(current).filter((m) => monthKey(m) <= monthKey(current));
  const claims = await db
    .select({ y: schema.contributionMonths.ethYear, m: schema.contributionMonths.ethMonth, status: schema.contributions.status })
    .from(schema.contributionMonths)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionMonths.contributionId))
    .where(eq(schema.contributionMonths.memberId, member.id));
  const status = new Map(claims.map((c) => [c.y * 100 + c.m, c.status]));
  const lines = months.map((m) => {
    const s = status.get(monthKey(m));
    return s === "approved" ? `✅ ${formatEth(lang, m)} — ${tr.account.paid}` : s === "pending" ? `⏳ ${formatEth(lang, m)} — ${tr.account.pending}` : `❌ ${formatEth(lang, m)} — ${tr.account.unpaid}`;
  });
  return {
    text: `${tr.botMenu.payTitle(rate)}\n\n${lines.join("\n")}`,
    reply_markup: { inline_keyboard: [[webApp(tr.botMenu.payBtn, `${site}/me?tab=pay`)]] },
  };
}

export function pagesReply(lang: Lang, site: string, isMember: boolean): BotReply {
  const m = t(lang).botMenu;
  const rows = isMember
    ? [
        [webApp(m.myPage, `${site}/me`), webApp(m.pay.replace(/^💳 /, "💳 "), `${site}/me?tab=pay`)],
        [webApp(m.materials, `${site}/me?tab=materials`), webApp(m.songsPage, `${site}/songs`)],
        [webApp(m.home, site)],
      ]
    : [[webApp(m.home, site)]];
  return { text: m.pagesTitle, reply_markup: { inline_keyboard: rows } };
}

export async function botNotifyFor(db: Db, userId: string) {
  return (await db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { botNotify: true } }))?.botNotify ?? true;
}

// ---------------------------------------------------------------- Staff (department) buttons

const LIST_CAP = 50;
const capList = (lang: Lang, names: string[]) =>
  names.length > LIST_CAP ? [...names.slice(0, LIST_CAP), t(lang).botMenu.more(names.length - LIST_CAP)] : names;
const contact = (r: { phone: string; telegramUsername: string | null }) => (r.telegramUsername ? `@${r.telegramUsername}` : r.phone);

/** Finance: this month's dues — counts, money in, and who hasn't paid yet. */
export async function unpaidReply(db: Db, lang: Lang, site: string): Promise<BotReply> {
  const tr = t(lang);
  const today = toEth(new Date());
  const month = currentDueMonth(today);
  const { rows, collected } = await monthPayRows(db, month, today);
  const unpaid = rows.filter((r) => r.status === "unpaid").sort((a, b) => a.fullName.localeCompare(b.fullName));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const [{ n: toReview }] = await db.select({ n: countRows() }).from(schema.contributions).where(eq(schema.contributions.status, "pending"));
  const lines = [tr.botMenu.unpaidTitle(formatEth(lang, month)), "", tr.botMenu.unpaidSummary(count("approved"), count("pending"), unpaid.length, rows.length, collected), ""];
  if (unpaid.length === 0) lines.push(tr.botMenu.allPaid);
  else lines.push(tr.botMenu.unpaidHeader, ...capList(lang, unpaid.map((r, i) => `${i + 1}. ${r.fullName} · ${tr.dept[r.department]} · ${contact(r)}`)));
  const keyboard: unknown[][] = [[webApp(tr.botMenu.reviewBtn(toReview), `${site}/finance`), webApp(tr.botMenu.monthBtn, `${site}/finance/month`)]];
  if (unpaid.length) keyboard.push([{ text: tr.botMenu.remindBtn, callback_data: "f:remind" }]);
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: keyboard } };
}

/** Private reminder to each unpaid member (once a day at most; members who turned messages off are skipped). */
export async function remindUnpaid(db: Db, site: string) {
  const today = toEth(new Date());
  const month = currentDueMonth(today);
  const { rows } = await monthPayRows(db, month, today);
  const dues = await getDues(db);
  const unpaidIds = rows.filter((r) => r.status === "unpaid").map((r) => r.id);
  if (unpaidIds.length === 0) return [];
  const targets = await db
    .select({ id: schema.members.id, name: schema.members.fullName, lang: schema.members.lang, telegramId: schema.user.telegramId, botNotify: schema.user.botNotify })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(inArray(schema.members.id, unpaidIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return targets
    .filter((m) => m.telegramId && m.botNotify)
    .map((m) => ({
      dedupeKey: `remindnow:${m.id}:${monthKey(month)}:${todayIso()}`,
      chatId: m.telegramId!,
      text: t(m.lang).botMenu.remindText(m.name, formatEth(m.lang, month), duesFor(byId.get(m.id)!.standing, dues), `${site}/me?tab=pay`),
    }));
}

/** Event preparation: who came to the last event, and the trend over recent ones. */
export async function attendanceReply(db: Db, lang: Lang, site: string): Promise<BotReply> {
  const tr = t(lang);
  const past = await db
    .select({ id: schema.events.id, type: schema.events.type, title: schema.events.title, date: schema.events.date })
    .from(schema.events)
    .where(and(lte(schema.events.date, todayIso()), eq(schema.events.status, "scheduled")))
    .orderBy(desc(schema.events.date))
    .limit(5);
  if (past.length === 0) return { text: tr.botMenu.noPast };
  const last = past[0];
  const active = await db.select({ id: schema.members.id, name: schema.members.fullName }).from(schema.members).where(eq(schema.members.status, "active")).orderBy(asc(schema.members.fullName));
  const marks = await db
    .select({ eventId: schema.attendance.eventId, memberId: schema.attendance.memberId })
    .from(schema.attendance)
    .where(inArray(schema.attendance.eventId, past.map((p) => p.id)));
  const came = new Set(marks.filter((m) => m.eventId === last.id).map((m) => m.memberId));
  const lines = [tr.botMenu.attTitle(eventTitle(lang, last), formatEth(lang, isoToEth(last.date))), ""];
  if (came.size === 0) lines.push(tr.botMenu.notMarked);
  else {
    lines.push(tr.botMenu.attSummary(came.size, active.length), "");
    lines.push(tr.botMenu.came, ...capList(lang, active.filter((m) => came.has(m.id)).map((m) => `• ${m.name}`)), "");
    lines.push(tr.botMenu.absent, ...capList(lang, active.filter((m) => !came.has(m.id)).map((m) => `• ${m.name}`)));
  }
  if (past.length > 1) {
    lines.push("", tr.botMenu.recent);
    for (const p of past) {
      const n = marks.filter((m) => m.eventId === p.id).length;
      const bar = "▰".repeat(Math.round((n / Math.max(1, active.length)) * 10)).padEnd(10, "▱");
      lines.push(`${formatEth(lang, isoToEth(p.date))}  ${bar}  ${n}`);
    }
  }
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: [[webApp(tr.botMenu.openEvent, `${site}/events/${last.id}`)]] } };
}

/** Event preparation: everything about the next event, with what's still missing flagged. */
export async function eventDetailsReply(db: Db, lang: Lang, site: string): Promise<BotReply> {
  const tr = t(lang);
  const e = await nextEvent(db);
  if (!e) return { text: tr.botMenu.nextNone, reply_markup: { inline_keyboard: [[webApp(tr.botMenu.openEvent, `${site}/events`)]] } };
  const [duties, program, songs, tasks] = await Promise.all([
    db
      .select({ duty: schema.eventDuties.duty, name: schema.members.fullName })
      .from(schema.eventDuties)
      .innerJoin(schema.members, eq(schema.members.id, schema.eventDuties.memberId))
      .where(eq(schema.eventDuties.eventId, e.id)),
    db.select().from(schema.eventProgram).where(eq(schema.eventProgram.eventId, e.id)).orderBy(asc(schema.eventProgram.sort)),
    db
      .select({ title: schema.songs.title })
      .from(schema.eventSongs)
      .innerJoin(schema.songs, eq(schema.songs.id, schema.eventSongs.songId))
      .where(eq(schema.eventSongs.eventId, e.id))
      .orderBy(asc(schema.eventSongs.sort)),
    db.select({ status: schema.eventTasks.status }).from(schema.eventTasks).where(eq(schema.eventTasks.eventId, e.id)),
  ]);
  const lines = [`📅 ${eventTitle(lang, e)}`, when(lang, e), tr.botMenu.daysLeft(Math.max(0, daysBetween(todayIso(), e.date)))];
  if (e.description) lines.push("", e.description);
  lines.push("", tr.bot.dutiesHeader);
  for (const d of DUTIES) {
    const names = duties.filter((x) => x.duty === d).map((x) => x.name);
    lines.push(`• ${tr.events.dutyNames[d]} (${names.length}/${MAX_PER_DUTY}): ${names.length ? names.join(", ") : tr.botMenu.missing}`);
  }
  lines.push("");
  if (program.length) lines.push(tr.botMenu.program, ...program.map((p, i) => `${i + 1}. ${p.part}${p.person ? ` — ${p.person}` : ""}`));
  else lines.push(tr.botMenu.noProgram);
  lines.push("");
  if (songs.length) lines.push(tr.bot.songsHeader, ...songs.map((s, i) => `${i + 1}. ${s.title}`));
  else lines.push(`🎵 ${tr.botMenu.noSongs}`);
  if (tasks.length) lines.push("", tr.botMenu.tasks(tasks.filter((x) => x.status === "done").length, tasks.filter((x) => x.status === "open").length));
  return {
    text: lines.join("\n"),
    reply_markup: {
      inline_keyboard: [
        [webApp(tr.botMenu.openEvent, `${site}/events/${e.id}?tab=edit`), webApp(tr.botMenu.dutiesBtn, `${site}/events/${e.id}?tab=duties`)],
        [{ text: tr.botMenu.notifyBtn, callback_data: `e:notify:${e.id}` }],
      ],
    },
  };
}

/** Yes / No buttons before anything is sent to many people. */
export const confirmMarkup = (lang: Lang, yes: string, no = "x:no") => ({
  inline_keyboard: [[{ text: t(lang).botMenu.yes, callback_data: yes }, { text: t(lang).botMenu.no, callback_data: no }]],
});
