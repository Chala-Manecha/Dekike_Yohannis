/**
 * One-off Telegram messages for things that just happened (the scheduled reminders are in notify.ts).
 * Pure: builds outbox items; notices.server.ts finds the recipients and sends them.
 * Tested in tests/notices.test.ts.
 */
import { formatEth, t } from "./i18n";
import type { Lang } from "./lang";
import type { OutboxItem } from "./notify";
import type { Role } from "./permissions";

export type Recipient = { userId: string; telegramId: string | null; lang: Lang };

const item = (r: Recipient, key: string, text: string): OutboxItem[] => (r.telegramId ? [{ dedupeKey: key, chatId: r.telegramId, text }] : []);

export function welcomeNotice(r: Recipient, memberId: string, name: string) {
  return item(r, `welcome:${memberId}`, t(r.lang).notices.welcome(name));
}

export function approvedNotice(r: Recipient, memberId: string, name: string, site: string) {
  return item(r, `approved:${memberId}`, t(r.lang).notices.approved(name, site));
}

export function newRegistrationNotices(coordinators: Recipient[], m: { id: string; name: string; department: "cs" | "it" | "ee"; graduate: boolean }, site: string) {
  return coordinators.flatMap((r) => {
    const tr = t(r.lang);
    return item(r, `newreg:${m.id}:${r.userId}`, tr.notices.newRegistration(m.name, tr.dept[m.department], m.graduate ? tr.standing.graduateShort : tr.standing.studentShort, `${site}/members`));
  });
}

export function roleNotice(r: Recipient, role: Role, site: string, at: number) {
  const tr = t(r.lang);
  return item(r, `role:${r.userId}:${role}:${at}`, role === "member" ? tr.notices.roleRemoved : tr.notices.roleAssigned(tr.roles[role], `${site}/dashboard`));
}

export function paymentSubmittedNotices(finance: Recipient[], p: { id: string; name: string; amount: number; months: [number, number][] }, site: string) {
  return finance.flatMap((r) => {
    const tr = t(r.lang);
    const months = p.months.map(([year, month]) => formatEth(r.lang, { year, month })).join(", ");
    return item(r, `paysub:${p.id}:${r.userId}`, tr.notices.paymentSubmitted(p.name, p.amount, months, `${site}/finance`));
  });
}

export function paymentReviewedNotice(r: Recipient, p: { id: string; amount: number; months: [number, number][]; approved: boolean; note: string | null }, site: string) {
  const tr = t(r.lang);
  const months = p.months.map(([year, month]) => formatEth(r.lang, { year, month })).join(", ");
  return item(
    r,
    `payrev:${p.id}`,
    p.approved ? tr.notices.paymentApproved(p.amount, months) : tr.notices.paymentRejected(months, p.note, `${site}/me`),
  );
}
