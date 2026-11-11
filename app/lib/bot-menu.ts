/**
 * The keyboard under the bot chat. Pure: labels and which button a typed text is.
 * Tested in tests/bot-menu.test.ts.
 */
import { DICTS, t } from "./i18n";
import type { Lang } from "./lang";
import { can, type Role } from "./permissions";

export type MenuAction = "next" | "songs" | "pay" | "pages" | "notify" | "register" | "open" | "unpaid" | "attendance" | "eventDetails";

/** Department rows: Finance sees unpaid members; event preparation sees attendance and the next event. */
export const staffButtons = (role: Role) => ({ finance: can(role, "finance:view"), events: can(role, "event:manage") });

/** Buttons for people who aren't members yet: both languages on one button. */
export const GUEST_REGISTER = `${DICTS.om.botReg.registerBtn} · ${DICTS.am.botReg.registerBtn.replace("📝 ", "")}`;
export const GUEST_OPEN = `${DICTS.om.botReg.openBtn} · ${DICTS.am.botReg.openBtn.replace("📖 ", "")}`;

export function memberKeyboard(lang: Lang, notifyOn: boolean, role: Role = "member", isMember = true) {
  const m = t(lang).botMenu;
  const staff = staffButtons(role);
  const rows: { text: string }[][] = [];
  // Department buttons first: they are what that person opens the bot for
  if (staff.events) rows.push([{ text: m.eventDetails }, { text: m.attendance }]);
  if (staff.finance) rows.push([{ text: m.unpaid }]);
  if (isMember) rows.push([{ text: m.next }, { text: m.songs }], [{ text: m.pay }, { text: notifyOn ? m.notifyOn : m.notifyOff }]);
  else rows.push([{ text: m.next }, { text: notifyOn ? m.notifyOn : m.notifyOff }]);
  rows.push([{ text: m.pages }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
  };
}

export const guestKeyboard = () => ({
  keyboard: [[{ text: GUEST_REGISTER }], [{ text: GUEST_OPEN }]],
  resize_keyboard: true,
  is_persistent: true,
});

/** Which button was tapped (in either language), or null for ordinary text. */
export function menuAction(text: string | undefined): MenuAction | null {
  if (!text) return null;
  const s = text.trim();
  if (s === GUEST_REGISTER) return "register";
  if (s === GUEST_OPEN) return "open";
  for (const lang of ["om", "am"] as const) {
    const m = DICTS[lang].botMenu;
    if (s === m.next) return "next";
    if (s === m.songs) return "songs";
    if (s === m.pay) return "pay";
    if (s === m.pages) return "pages";
    if (s === m.notifyOn || s === m.notifyOff) return "notify";
    if (s === m.unpaid) return "unpaid";
    if (s === m.attendance) return "attendance";
    if (s === m.eventDetails) return "eventDetails";
  }
  return null;
}

// ---------------------------------------------------------------- Group posts

const registerUrl = (botUsername: string) => `https://t.me/${botUsername}?start=register`;
const groupButtons = (botUsername: string, site: string) => ({
  inline_keyboard: [
    [{ text: GUEST_REGISTER, url: registerUrl(botUsername) }],
    [{ text: `🌐 ${DICTS.om.groupSite} · ${DICTS.am.groupSite}`, url: site }],
  ],
});

/** "Who I am and why to register", Oromo then Amharic; buttons open the bot or the site. */
export function groupIntro(botUsername: string, site: string) {
  return { text: `${DICTS.om.groupIntro}\n\n${DICTS.am.groupIntro}`, reply_markup: groupButtons(botUsername, site) };
}

/** Short hello for people who just joined the group and aren't registered yet. */
export function groupWelcome(names: string[], botUsername: string, site: string) {
  const who = names.join(", ");
  return { text: `${DICTS.om.groupWelcome(who)}\n${DICTS.am.groupWelcome(who)}`, reply_markup: groupButtons(botUsername, site) };
}
