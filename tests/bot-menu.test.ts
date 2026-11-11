import { describe, expect, it } from "vitest";
import { GUEST_OPEN, GUEST_REGISTER, groupIntro, groupWelcome, guestKeyboard, memberKeyboard, menuAction } from "../app/lib/bot-menu";
import { DICTS } from "../app/lib/i18n";

describe("bot keyboard", () => {
  it("recognises every member button in both languages", () => {
    for (const lang of ["om", "am"] as const) {
      const labels = memberKeyboard(lang, true).keyboard.flat().map((b) => b.text);
      expect(labels.map(menuAction)).toEqual(["next", "songs", "pay", "notify", "pages"]);
      expect(menuAction(DICTS[lang].botMenu.notifyOff)).toBe("notify");
    }
  });

  it("shows the current notification state on the button", () => {
    expect(memberKeyboard("am", false).keyboard[1][1].text).toBe(DICTS.am.botMenu.notifyOff);
    expect(memberKeyboard("om", true).keyboard[1][1].text).toBe(DICTS.om.botMenu.notifyOn);
  });

  it("guest buttons register or open; other text is not a button", () => {
    expect(guestKeyboard().keyboard.flat().map((b) => menuAction(b.text))).toEqual(["register", "open"]);
    expect(menuAction(GUEST_REGISTER)).toBe("register");
    expect(menuAction(GUEST_OPEN)).toBe("open");
    expect(menuAction("Abebe Kebede")).toBeNull();
    expect(menuAction(undefined)).toBeNull();
  });

  it("adds department rows by role", () => {
    const labels = (role: Parameters<typeof memberKeyboard>[2], isMember = true) => memberKeyboard("am", true, role, isMember).keyboard.flat().map((b) => menuAction(b.text));
    expect(labels("finance")).toEqual(["unpaid", "next", "songs", "pay", "notify", "pages"]);
    expect(labels("preparation")).toEqual(["eventDetails", "attendance", "next", "songs", "pay", "notify", "pages"]);
    expect(labels("leader")).toEqual(["eventDetails", "attendance", "unpaid", "next", "songs", "pay", "notify", "pages"]);
    expect(labels("songs")).toEqual(["next", "songs", "pay", "notify", "pages"]);
    // Staff without a member record still get their department buttons
    expect(labels("finance", false)).toEqual(["unpaid", "next", "notify", "pages"]);
  });

  it("group posts point to registration in the bot", () => {
    const p = groupIntro("DekikeYohannis_bot", "https://x.dev");
    expect(p.reply_markup.inline_keyboard[0][0].url).toBe("https://t.me/DekikeYohannis_bot?start=register");
    expect(p.reply_markup.inline_keyboard[1][0].url).toBe("https://x.dev");
    expect(p.text).toContain("Galmaa'i");
    expect(p.text).toContain("ተመዝገብ");
    expect(groupWelcome(["Abebe", "Chaltu"], "b", "s").text).toContain("Abebe, Chaltu");
  });
});
