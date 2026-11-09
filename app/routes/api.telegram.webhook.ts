import { eq } from "drizzle-orm";
import type { Route } from "./+types/api.telegram.webhook";
import { getDb, schema } from "../db";
import { memberByStudentId, userForTelegram, userIdForTelegram } from "../lib/accounts.server";
import { parseCommand, safeEqual, telegramName } from "../lib/bot-login";
import { prompt, regNext, START, type RegInput, type RegReply, type RegState } from "../lib/bot-register";
import { toEth } from "../lib/ethiopian";
import { DICTS, t } from "../lib/i18n";
import { createMember, memberForUser } from "../lib/members.server";

/**
 * Telegram calls this for messages to the bot and button taps (set up once with
 * setWebhook, see README). Telegram sends our secret in a header; anything else is refused.
 * Replies go back in the response body (saves an outgoing request).
 */

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
type TgMessage = {
  message_id: number;
  text?: string;
  contact?: { phone_number: string; user_id?: number };
  chat: { id: number; type: string };
  from?: TgUser;
};
type TgUpdate = {
  message?: TgMessage;
  callback_query?: { id: string; data?: string; from: TgUser; message?: { message_id: number; chat: { id: number } } };
};

const ok = () => new Response("ok");
const send = (chatId: number, text: string, reply_markup?: unknown) =>
  Response.json({ method: "sendMessage", chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}) });

function markup(reply: RegReply, sharePhone: string) {
  if (reply.choices) return { inline_keyboard: reply.choices.map((row) => row.map(([v, label]) => ({ text: label, callback_data: `r:${v}` }))) };
  if (reply.askContact) return { keyboard: [[{ text: sharePhone, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  if (reply.removeKeyboard) return { remove_keyboard: true };
  return undefined;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  if (!safeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }
  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  if (!update) return ok();
  const db = getDb(env.DB);
  const site = env.PUBLIC_SITE_URL;
  const api = (method: string, body: unknown) =>
    ctx.waitUntil(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {}),
    );
  const openButton = (label: string) => ({ inline_keyboard: [[{ text: label, web_app: { url: site } }]] });
  const both = (pick: (d: (typeof DICTS)["om"]) => string) => `${pick(DICTS.om)}\n${pick(DICTS.am)}`;

  async function existingMember(telegramId: number) {
    const userId = await userIdForTelegram(db, telegramId);
    return userId ? memberForUser(db, userId) : undefined;
  }

  async function beginRegistration(chatId: number, from: TgUser) {
    const member = await existingMember(from.id);
    if (member) return send(chatId, t(member.lang).botReg.already, openButton(t(member.lang).botReg.openBtn));
    await db
      .insert(schema.botRegistrations)
      .values({ chatId: String(chatId), step: START.step, data: START.data, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: schema.botRegistrations.chatId, set: { step: START.step, data: START.data, updatedAt: Date.now() } });
    const reply = prompt(START);
    return send(chatId, reply.text, markup(reply, DICTS.om.botReg.sharePhone));
  }

  async function continueRegistration(chatId: number, from: TgUser, state: RegState, input: RegInput) {
    const tr = t(state.data.lang === "am" ? "am" : "om");
    const result = regNext(state, input, toEth(new Date()));

    if ("checkStudentId" in result && result.checkStudentId && (await memberByStudentId(db, result.checkStudentId))) {
      const reply = prompt(state, tr.errors.studentIdTaken);
      return send(chatId, reply.text, markup(reply, tr.botReg.sharePhone));
    }

    if (result.state === null) {
      const userId = await userForTelegram(db, { id: from.id, name: telegramName(from), username: from.username ?? null });
      const error = await createMember(db, userId, result.submit, toEth(new Date()).year);
      await db.delete(schema.botRegistrations).where(eq(schema.botRegistrations.chatId, String(chatId)));
      if (error === "studentIdTaken") return send(chatId, `${tr.errors.studentIdTaken}\n/register`);
      if (error === "alreadyMember") return send(chatId, tr.botReg.already, openButton(tr.botReg.openBtn));
      return send(chatId, result.reply.text, openButton(tr.botReg.openBtn));
    }

    await db
      .update(schema.botRegistrations)
      .set({ step: result.state.step, data: result.state.data, updatedAt: Date.now() })
      .where(eq(schema.botRegistrations.chatId, String(chatId)));
    return send(chatId, result.reply.text, markup(result.reply, tr.botReg.sharePhone));
  }

  const msg = update.message;
  if (msg?.from && !msg.from.is_bot) {
    const chatId = msg.chat.id;
    const cmd = parseCommand(msg.text);
    // In a group: "/chatid" prints the id to put in TELEGRAM_GROUP_CHAT_ID
    if (cmd?.command === "chatid") return send(chatId, `chat id: ${chatId}`);
    if (msg.chat.type !== "private") return ok();

    if (cmd?.command === "register" || (cmd?.command === "start" && cmd.payload === "register")) return beginRegistration(chatId, msg.from);
    if (cmd?.command === "cancel") {
      await db.delete(schema.botRegistrations).where(eq(schema.botRegistrations.chatId, String(chatId)));
      return send(chatId, both((d) => d.botReg.cancelled), { remove_keyboard: true });
    }
    if (cmd?.command === "start") {
      const member = await existingMember(msg.from.id);
      if (member) return send(chatId, t(member.lang).botReg.welcomeMember, openButton(t(member.lang).botReg.openBtn));
      return send(chatId, both((d) => d.botReg.intro), {
        inline_keyboard: [
          [{ text: `${DICTS.om.botReg.registerBtn} · ${DICTS.am.botReg.registerBtn.replace("📝 ", "")}`, callback_data: "r:start" }],
          [{ text: `${DICTS.om.botReg.openBtn} · ${DICTS.am.botReg.openBtn.replace("📖 ", "")}`, web_app: { url: site } }],
        ],
      });
    }

    const session = await db.query.botRegistrations.findFirst({ where: eq(schema.botRegistrations.chatId, String(chatId)) });
    if (!session) return ok();
    // Only the member's own number counts as a shared contact
    const input: RegInput | null =
      msg.contact && msg.contact.user_id === msg.from.id
        ? { kind: "contact", phone: msg.contact.phone_number }
        : msg.text
          ? { kind: "text", text: msg.text }
          : null;
    if (!input) return ok();
    return continueRegistration(chatId, msg.from, { step: session.step as RegState["step"], data: session.data }, input);
  }

  const cb = update.callback_query;
  if (cb?.message && cb.data?.startsWith("r:") && !cb.from.is_bot) {
    const chatId = cb.message.chat.id;
    api("answerCallbackQuery", { callback_query_id: cb.id });
    // Remove the tapped buttons so an old question can't be answered twice
    api("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    const value = cb.data.slice(2);
    if (value === "start") return beginRegistration(chatId, cb.from);
    const session = await db.query.botRegistrations.findFirst({ where: eq(schema.botRegistrations.chatId, String(chatId)) });
    if (!session) return ok();
    return continueRegistration(chatId, cb.from, { step: session.step as RegState["step"], data: session.data }, { kind: "choice", value });
  }

  return ok();
}

export function loader() {
  return new Response("Not found", { status: 404 });
}
