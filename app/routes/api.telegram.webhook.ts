import { and, eq, gt } from "drizzle-orm";
import type { Route } from "./+types/api.telegram.webhook";
import { getDb, schema } from "../db";
import { isExpired, loginCallbackData, parseLoginCallback, parseStart, safeEqual, telegramName } from "../lib/bot-login";

/**
 * Telegram calls this for messages to the bot and button taps (set up once with
 * setWebhook, see README). Telegram sends our secret in a header; anything else is refused.
 * Replies go back in the response body where possible (saves an outgoing request).
 */

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
type TgUpdate = {
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: TgUser };
  callback_query?: { id: string; data?: string; from: TgUser; message?: { message_id: number; chat: { id: number } } };
};

const SIGN_IN_TEXT =
  "🔐 Weebsaayitii Xoofoo Qulqulluu Yohaannisitti seenuuf \"Seeni\" tuqi. Yoo ati amma hin gaafatin ta'e, hin tuqin.\n\n" +
  "🔐 ወደ ቅዱስ ዮሐንስ ዝክር ድረ ገጽ ለመግባት \"ግባ\" የሚለውን ይጫኑ። እርስዎ አሁን ካልጠየቁ አይጫኑ።";
const SIGNED_IN_TEXT = "✅ Seenteetta — gara weebsaayitii deebi'i.\n✅ ገብተዋል — ወደ ድረ ገጹ ይመለሱ።";
const EXPIRED_TEXT = "⌛ Yeroon darbeera. Weebsaayitii irraa irra deebi'ii yaali.\n⌛ ጊዜው አልፏል። ከድረ ገጹ እንደገና ይሞክሩ።";

const reply = (body: Record<string, unknown>) => Response.json(body);
const ok = () => new Response("ok");

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  if (!safeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }
  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  if (!update) return ok();
  const db = getDb(env.DB);
  const now = Date.now();
  const site = env.PUBLIC_SITE_URL;

  const msg = update.message;
  if (msg?.text) {
    const chatId = msg.chat.id;
    // In a group: "/chatid" prints the id to put in TELEGRAM_GROUP_CHAT_ID
    if (/^\/chatid(@\w+)?$/.test(msg.text.trim())) {
      return reply({ method: "sendMessage", chat_id: chatId, text: `chat id: ${chatId}` });
    }
    if (msg.chat.type !== "private") return ok();

    const code = parseStart(msg.text);
    if (code === null) return ok();
    if (code) {
      const row = await db.query.botLogins.findFirst({
        where: and(eq(schema.botLogins.code, code), eq(schema.botLogins.status, "pending"), gt(schema.botLogins.expiresAt, now)),
        columns: { code: true },
      });
      if (!row) return reply({ method: "sendMessage", chat_id: chatId, text: EXPIRED_TEXT });
      return reply({
        method: "sendMessage",
        chat_id: chatId,
        text: SIGN_IN_TEXT,
        reply_markup: { inline_keyboard: [[{ text: "✅ Seeni · ግባ", callback_data: loginCallbackData(code) }]] },
      });
    }
    return reply({
      method: "sendMessage",
      chat_id: chatId,
      text: `👋 Baga nagaan dhuftan! · እንኳን ደህና መጡ!\n${site}`,
      disable_web_page_preview: true,
    });
  }

  const cb = update.callback_query;
  if (cb) {
    const code = parseLoginCallback(cb.data);
    if (!code || cb.from.is_bot) return reply({ method: "answerCallbackQuery", callback_query_id: cb.id });
    const row = await db.query.botLogins.findFirst({ where: eq(schema.botLogins.code, code) });
    const valid = row && row.status === "pending" && !isExpired(row.expiresAt, now);
    if (valid) {
      await db
        .update(schema.botLogins)
        .set({ status: "confirmed", telegramId: String(cb.from.id), name: telegramName(cb.from), username: cb.from.username ?? null })
        .where(and(eq(schema.botLogins.code, code), eq(schema.botLogins.status, "pending")));
    }
    // Replace the button with the result so it can't be tapped again
    if (cb.message) {
      context.cloudflare.ctx.waitUntil(
        fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: valid ? SIGNED_IN_TEXT : EXPIRED_TEXT }),
        }).catch(() => {}),
      );
    }
    return reply({ method: "answerCallbackQuery", callback_query_id: cb.id });
  }

  return ok();
}

export function loader() {
  return new Response("Not found", { status: 404 });
}
