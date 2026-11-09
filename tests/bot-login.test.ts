import { describe, expect, it } from "vitest";
import {
  botStartLink,
  isExpired,
  isLoginCode,
  loginCallbackData,
  newLoginCode,
  parseLoginCallback,
  parseStart,
  safeEqual,
  telegramName,
} from "../app/lib/bot-login";

describe("login codes", () => {
  it("are 32 URL-safe characters and unique", () => {
    const a = newLoginCode();
    expect(isLoginCode(a)).toBe(true);
    expect(newLoginCode()).not.toBe(a);
    expect(botStartLink("DekikeYohannis_bot", a)).toBe(`https://t.me/DekikeYohannis_bot?start=login_${a}`);
    // Telegram allows at most 64 characters in a start parameter
    expect(`login_${a}`.length).toBeLessThanOrEqual(64);
  });
});

describe("parseStart", () => {
  const code = "A".repeat(32);
  it("reads the code from a deep link", () => {
    expect(parseStart(`/start login_${code}`)).toBe(code);
    expect(parseStart(`/start@DekikeYohannis_bot login_${code}`)).toBe(code);
  });
  it("treats plain or unknown /start as a normal start", () => {
    expect(parseStart("/start")).toBe("");
    expect(parseStart("/start hello")).toBe("");
    expect(parseStart("/start login_short")).toBe("");
  });
  it("ignores other messages", () => {
    expect(parseStart("hello")).toBeNull();
    expect(parseStart(undefined)).toBeNull();
    expect(parseStart("/started")).toBeNull();
  });
});

describe("callback data", () => {
  it("round-trips and fits Telegram's 64-byte limit", () => {
    const code = newLoginCode();
    const data = loginCallbackData(code);
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseLoginCallback(data)).toBe(code);
    expect(parseLoginCallback("login:bad")).toBeNull();
    expect(parseLoginCallback("other")).toBeNull();
  });
});

describe("helpers", () => {
  it("expires codes on time", () => {
    expect(isExpired(1000, 999)).toBe(false);
    expect(isExpired(1000, 1000)).toBe(true);
  });
  it("compares secrets safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
    expect(safeEqual("abc", undefined)).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
  it("builds a display name", () => {
    expect(telegramName({ id: 1, first_name: "Chala", last_name: "Manecha" })).toBe("Chala Manecha");
    expect(telegramName({ id: 1, username: "chala" })).toBe("chala");
    expect(telegramName({ id: 7 })).toBe("Telegram 7");
  });
});
