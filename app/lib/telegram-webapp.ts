/**
 * Telegram Mini App sign-in. When the site is opened from the bot's menu button,
 * Telegram passes signed "init data" in the URL fragment (#tgWebAppData=...).
 * We check its signature with the bot token, so nobody can fake another member.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Pure, tested in tests/telegram-webapp.test.ts.
 */

export const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;

export type WebAppUser = { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string };

const enc = new TextEncoder();

async function hmac(key: Uint8Array<ArrayBuffer>, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** "key=value" lines of every field except hash, sorted by key. */
export function webAppCheckString(params: URLSearchParams) {
  return [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export async function signWebAppData(params: URLSearchParams, botToken: string) {
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  return toHex(await hmac(secret, webAppCheckString(params)));
}

export async function verifyWebAppInitData(
  initData: string,
  botToken: string,
  nowMs: number,
): Promise<{ ok: true; user: WebAppUser } | { ok: false; reason: "bad_signature" | "expired" | "no_user" }> {
  if (!botToken || !initData) return { ok: false, reason: "bad_signature" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: "bad_signature" };
  const expected = await signWebAppData(params, botToken);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ hash.toLowerCase().charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "bad_signature" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowMs / 1000 - authDate > INIT_DATA_MAX_AGE_S) return { ok: false, reason: "expired" };

  try {
    const user = JSON.parse(params.get("user") ?? "") as WebAppUser;
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) return { ok: false, reason: "no_user" };
    return { ok: true, user };
  } catch {
    return { ok: false, reason: "no_user" };
  }
}

/** Reads init data from a URL fragment like "#tgWebAppData=...&tgWebAppVersion=7.0". */
export function initDataFromHash(hash: string): string | null {
  const v = new URLSearchParams(hash.replace(/^#/, "")).get("tgWebAppData");
  return v || null;
}
