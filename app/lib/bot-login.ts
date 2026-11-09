/** Small helpers for the bot webhook. Tested in tests/bot-login.test.ts. */

/** Bot commands: "/start", "/start@Bot payload", "/register" → { command, payload }. */
export function parseCommand(text: string | undefined): { command: string; payload: string } | null {
  const m = text?.trim().match(/^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?$/i);
  return m ? { command: m[1].toLowerCase(), payload: m[2] ?? "" } : null;
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
