import { and, asc, eq, gte } from "drizzle-orm";
import { schema, type Db } from "../db";
import { classInfo, duesFor } from "./classyear";
import { payableMonths } from "./contributions";
import { isoToEth, todayIso } from "./dates";
import { currentDueMonth, monthKey, toEth } from "./ethiopian";
import { formatEth, t } from "./i18n";
import type { Lang } from "./lang";
import { DUTIES, eventTitle, when } from "./notify";
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
