import { describe, expect, it } from "vitest";
import { parseCommand, safeEqual, telegramName } from "../app/lib/bot-login";

describe("parseCommand", () => {
  it("reads commands with or without the bot name and payload", () => {
    expect(parseCommand("/start")).toEqual({ command: "start", payload: "" });
    expect(parseCommand("/start@DekikeYohannis_bot register")).toEqual({ command: "start", payload: "register" });
    expect(parseCommand(" /Register ")).toEqual({ command: "register", payload: "" });
  });
  it("ignores normal messages", () => {
    expect(parseCommand("Abebe Kebede")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand("/start a b")).toBeNull();
  });
});

describe("helpers", () => {
  it("compares secrets safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
  it("builds a display name", () => {
    expect(telegramName({ id: 1, first_name: "Chala", last_name: "Manecha" })).toBe("Chala Manecha");
    expect(telegramName({ id: 1, username: "chala" })).toBe("chala");
    expect(telegramName({ id: 7 })).toBe("Telegram 7");
  });
});
