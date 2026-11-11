import { describe, expect, it } from "vitest";
import { GUEST_OPEN, GUEST_REGISTER, guestKeyboard, memberKeyboard, menuAction } from "../app/lib/bot-menu";
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
});
