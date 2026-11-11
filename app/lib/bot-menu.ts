/**
 * The keyboard under the bot chat. Pure: labels and which button a typed text is.
 * Tested in tests/bot-menu.test.ts.
 */
import { DICTS, t } from "./i18n";
import type { Lang } from "./lang";

export type MenuAction = "next" | "songs" | "pay" | "pages" | "notify" | "register" | "open";

/** Buttons for people who aren't members yet: both languages on one button. */
export const GUEST_REGISTER = `${DICTS.om.botReg.registerBtn} · ${DICTS.am.botReg.registerBtn.replace("📝 ", "")}`;
export const GUEST_OPEN = `${DICTS.om.botReg.openBtn} · ${DICTS.am.botReg.openBtn.replace("📖 ", "")}`;

export function memberKeyboard(lang: Lang, notifyOn: boolean) {
  const m = t(lang).botMenu;
  return {
    keyboard: [
      [{ text: m.next }, { text: m.songs }],
      [{ text: m.pay }, { text: notifyOn ? m.notifyOn : m.notifyOff }],
      [{ text: m.pages }],
    ],
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
  }
  return null;
}
