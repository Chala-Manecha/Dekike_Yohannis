/**
 * Sign-in through the bot (no phone number on any web page):
 *  1. /login asks the server for a one-time code; the code is also stored in an
 *     HttpOnly cookie in that browser.
 *  2. The button opens t.me/<bot>?start=login_<code>. The member taps Start, then
 *     "Sign in" under the bot's message.
 *  3. The webhook marks the code as confirmed by that Telegram account.
 *  4. The browser that holds the cookie polls and gets the session.
 * A code only works for 10 minutes, once, and only in the browser that asked for it.
 * Pure helpers, tested in tests/bot-login.test.ts.
 */

export const LOGIN_TTL_MS = 10 * 60 * 1000;
export const LOGIN_COOKIE = "dy_bot_login";
const START_PREFIX = "login_";
const CALLBACK_PREFIX = "login:";
const CODE_RE = /^[A-Za-z0-9_-]{32}$/;

/** 24 random bytes as 32 URL-safe characters (fits Telegram's 64-char start parameter). */
export function newLoginCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

export function isLoginCode(v: unknown): v is string {
  return typeof v === "string" && CODE_RE.test(v);
}

export function botStartLink(botUsername: string, code: string) {
  return `https://t.me/${botUsername}?start=${START_PREFIX}${code}`;
}

/** "/start login_<code>" → code; "/start" alone → "" ; anything else → null. */
export function parseStart(text: string | undefined): string | null {
  const m = text?.trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (!m) return null;
  const payload = m[1] ?? "";
  if (payload === "") return "";
  const code = payload.startsWith(START_PREFIX) ? payload.slice(START_PREFIX.length) : "";
  return isLoginCode(code) ? code : "";
}

export function loginCallbackData(code: string) {
  return `${CALLBACK_PREFIX}${code}`;
}

export function parseLoginCallback(data: string | undefined): string | null {
  if (!data?.startsWith(CALLBACK_PREFIX)) return null;
  const code = data.slice(CALLBACK_PREFIX.length);
  return isLoginCode(code) ? code : null;
}

export function isExpired(expiresAt: number, now = Date.now()) {
  return expiresAt <= now;
}

/** Constant-time compare for the webhook's secret header. */
export function safeEqual(a: string | null, b: string | undefined) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function telegramName(from: { first_name?: string; last_name?: string; username?: string; id: number }) {
  return [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || from.username || `Telegram ${from.id}`;
}
