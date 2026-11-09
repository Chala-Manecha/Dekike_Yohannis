import { REMINDER_DAYS_BEFORE } from "../config";
import { daysBetween, isoToEth } from "./dates";
import type { EventType } from "./events";
import { formatEth, t } from "./i18n";
import type { Lang } from "./lang";

export type PlanEvent = {
  id: string;
  type: EventType;
  title: string | null;
  date: string; // ISO
  time: string | null;
  place: string | null;
  dueYear: number | null;
  dueMonth: number | null;
};

export type PlanMember = {
  id: string;
  name: string;
  telegramId: string | null;
  lang: Lang;
  /** yyyymm keys of months with a pending or approved contribution */
  claimed: Set<number>;
  monthlyDue: number;
};

export type OutboxItem = { dedupeKey: string; chatId: string; text: string };

export function eventTitle(lang: Lang, e: Pick<PlanEvent, "type" | "title">) {
  return e.title?.trim() || t(lang).events.types[e.type];
}

function when(lang: Lang, e: PlanEvent) {
  const parts = [formatEth(lang, isoToEth(e.date))];
  if (e.time) parts.push(e.time);
  if (e.place) parts.push(e.place);
  return parts.join(" · ");
}

/** Group posts are bilingual: Afaan Oromoo first, then Amharic. */
function bilingual(build: (lang: Lang) => string) {
  return `${build("om")}\n\n${build("am")}`;
}

/**
 * Decide which Telegram messages today needs. Pure: no database, no network.
 *  - Group: announce each event when it enters the 3-day window (once per date).
 *  - Zikr, 3..1 days before: private reminder to each active member who hasn't paid that month (once per day).
 *  - Zikr day: list unpaid members in the group (once).
 */
export function planDaily(input: {
  today: string;
  events: PlanEvent[];
  members: PlanMember[];
  groupChatId: string | null;
  siteUrl: string;
}): OutboxItem[] {
  const { today, events, members, groupChatId, siteUrl } = input;
  const out: OutboxItem[] = [];

  for (const e of events) {
    const daysLeft = daysBetween(today, e.date);
    if (daysLeft < 0) continue;

    if (groupChatId && daysLeft <= REMINDER_DAYS_BEFORE) {
      out.push({
        dedupeKey: `announce:${e.id}:${e.date}`,
        chatId: groupChatId,
        text: bilingual((l) => t(l).bot.announce(eventTitle(l, e), when(l, e))),
      });
    }

    if (e.type !== "zikr" || e.dueYear === null || e.dueMonth === null) continue;
    const key = e.dueYear * 100 + e.dueMonth;
    const unpaid = members.filter((m) => !m.claimed.has(key));

    if (daysLeft >= 1 && daysLeft <= REMINDER_DAYS_BEFORE) {
      for (const m of unpaid) {
        if (!m.telegramId) continue;
        const b = t(m.lang).bot;
        out.push({
          dedupeKey: `remind:${e.id}:${m.id}:${today}`,
          chatId: m.telegramId,
          text: b.reminder(m.name, formatEth(m.lang, { year: e.dueYear, month: e.dueMonth }), m.monthlyDue, daysLeft, `${siteUrl}/me`),
        });
      }
    }

    if (daysLeft === 0 && groupChatId && unpaid.length > 0) {
      const names = unpaid.map((m, i) => `${i + 1}. ${m.name}`).join("\n");
      out.push({
        dedupeKey: `unpaidlist:${e.id}:${e.date}`,
        chatId: groupChatId,
        text: bilingual((l) => t(l).bot.unpaidList(formatEth(l, { year: e.dueYear!, month: e.dueMonth! }))) + `\n\n${names}`,
      });
    }
  }
  return out;
}

/** Messages when an event's date changes: group post + a private note to every active member. */
export function planReschedule(e: PlanEvent, members: Pick<PlanMember, "id" | "telegramId" | "lang">[], groupChatId: string | null): OutboxItem[] {
  const out: OutboxItem[] = [];
  if (groupChatId) {
    out.push({
      dedupeKey: `resched:${e.id}:${e.date}:group`,
      chatId: groupChatId,
      text: bilingual((l) => t(l).bot.rescheduled(eventTitle(l, e), when(l, e))),
    });
  }
  for (const m of members) {
    if (!m.telegramId) continue;
    out.push({
      dedupeKey: `resched:${e.id}:${e.date}:${m.id}`,
      chatId: m.telegramId,
      text: t(m.lang).bot.rescheduled(eventTitle(m.lang, e), when(m.lang, e)),
    });
  }
  return out;
}
