import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dataCheckString, verifyTelegramLogin, type TelegramLoginData } from "../app/lib/telegram-verify";

const BOT_TOKEN = "123456:TEST-token";
const NOW = 1_800_000_000_000;

// Independent reference implementation with node:crypto, per Telegram docs
function sign(fields: Record<string, unknown>) {
  const secret = createHash("sha256").update(BOT_TOKEN).digest();
  return createHmac("sha256", secret).update(dataCheckString(fields)).digest("hex");
}

function login(overrides: Partial<TelegramLoginData> = {}): TelegramLoginData {
  const fields = { id: 42, first_name: "Abebe", username: "abebe", auth_date: NOW / 1000 - 60, ...overrides };
  delete (fields as Record<string, unknown>).hash;
  return { ...fields, hash: sign(fields) } as TelegramLoginData;
}

describe("verifyTelegramLogin", () => {
  it("accepts a correctly signed, fresh login", async () => {
    expect(await verifyTelegramLogin(login(), BOT_TOKEN, NOW)).toEqual({ ok: true });
  });

  it("rejects tampered data", async () => {
    const data = { ...login(), id: 43 };
    expect(await verifyTelegramLogin(data, BOT_TOKEN, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature made with another bot's token", async () => {
    expect(await verifyTelegramLogin(login(), "999:other", NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects logins older than a day", async () => {
    const data = login({ auth_date: NOW / 1000 - 60 * 60 * 25 });
    expect(await verifyTelegramLogin(data, BOT_TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("includes extra fields Telegram sends in the signature", async () => {
    const data = login({ photo_url: "https://t.me/i/userpic/1.jpg" });
    expect(await verifyTelegramLogin(data, BOT_TOKEN, NOW)).toEqual({ ok: true });
    const { photo_url: _drop, ...stripped } = data;
    expect((await verifyTelegramLogin(stripped as TelegramLoginData, BOT_TOKEN, NOW)).ok).toBe(false);
  });
});
