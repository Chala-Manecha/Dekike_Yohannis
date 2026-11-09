import { describe, expect, it } from "vitest";
import { initDataFromHash, signWebAppData, verifyWebAppInitData } from "../app/lib/telegram-webapp";

const TOKEN = "123456:TEST-token";
const NOW = 1_800_000_000_000;

async function initData(fields: Record<string, string>, token = TOKEN) {
  const p = new URLSearchParams(fields);
  p.set("hash", await signWebAppData(p, token));
  return p.toString();
}
const user = JSON.stringify({ id: 42, first_name: "Chala", username: "chala" });
const fresh = String(Math.floor(NOW / 1000) - 60);

describe("verifyWebAppInitData", () => {
  it("accepts data signed with our bot token", async () => {
    const r = await verifyWebAppInitData(await initData({ auth_date: fresh, query_id: "AAH", user }), TOKEN, NOW);
    expect(r).toEqual({ ok: true, user: { id: 42, first_name: "Chala", username: "chala" } });
  });
  it("rejects another bot's signature or edited data", async () => {
    expect(await verifyWebAppInitData(await initData({ auth_date: fresh, user }, "999:other"), TOKEN, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const tampered = (await initData({ auth_date: fresh, user })).replace("Chala", "Mallory");
    expect(await verifyWebAppInitData(tampered, TOKEN, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyWebAppInitData("user=x", TOKEN, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyWebAppInitData(await initData({ auth_date: fresh, user }), "", NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects old data and data without a user", async () => {
    const old = String(Math.floor(NOW / 1000) - 2 * 86400);
    expect(await verifyWebAppInitData(await initData({ auth_date: old, user }), TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyWebAppInitData(await initData({ auth_date: fresh }), TOKEN, NOW)).toEqual({ ok: false, reason: "no_user" });
  });
  it("reads init data from the URL fragment", () => {
    expect(initDataFromHash("#tgWebAppData=auth_date%3D1%26hash%3Dab&tgWebAppVersion=7.0")).toBe("auth_date=1&hash=ab");
    expect(initDataFromHash("#section")).toBeNull();
    expect(initDataFromHash("")).toBeNull();
  });
});
