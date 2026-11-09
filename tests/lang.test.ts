import { describe, expect, it } from "vitest";
import { chosenLang, DEFAULT_LANG, langCookie, langFromCookie } from "../app/lib/lang";

describe("language choice", () => {
  it("is null on a first visit, so the chooser shows", () => {
    expect(chosenLang(null)).toBeNull();
    expect(chosenLang("other=1")).toBeNull();
    expect(langFromCookie(null)).toBe(DEFAULT_LANG);
  });

  it("reads a saved choice among other cookies", () => {
    expect(chosenLang("lang=am")).toBe("am");
    expect(chosenLang("a=1; lang=om; b=2")).toBe("om");
  });

  it("ignores unknown or tampered values", () => {
    expect(chosenLang("lang=en")).toBeNull();
    expect(chosenLang("lang=amx")).toBeNull();
    expect(chosenLang("xlang=am")).toBeNull();
  });

  it("writes a long-lived cookie", () => {
    expect(langCookie("am")).toMatch(/^lang=am; Path=\/; Max-Age=34560000;/);
  });
});
