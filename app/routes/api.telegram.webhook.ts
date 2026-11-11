import { eq } from "drizzle-orm";
import type { Route } from "./+types/api.telegram.webhook";
import { getDb, schema } from "../db";
import { memberByStudentId, userForTelegram, userIdForTelegram } from "../lib/accounts.server";
import { parseCommand, safeEqual, telegramName } from "../lib/bot-login";
import { prompt, regNext, START, type RegInput, type RegReply, type RegState } from "../lib/bot-register";
import { toEth } from "../lib/ethiopian";
import { DICTS, t } from "../lib/i18n";
import { createMember, memberForUser } from "../lib/members.server";
import { newRegistrationNotices } from "../lib/notices";
import { notify, recipientsWithRoles } from "../lib/notices.server";
import { guestKeyboard, memberKeyboard, menuAction } from "../lib/bot-menu";
import { attendanceReply, confirmMarkup, eventDetailsReply, nextReply, pagesReply, payReply, remindUnpaid, songsReply, unpaidReply, type BotReply } from "../lib/bot-menu.server";
import { staffButtons } from "../lib/bot-menu";
import { releaseEvent } from "../lib/events.server";
import { enqueue, drainOutbox } from "../lib/notify.server";
import { DEFAULT_LANG } from "../lib/lang";
import type { Role } from "../lib/permissions";

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

  /** Who is writing: their account (role, messages on/off) and member record, if any. */
  async function who(telegramId: number) {
    const userId = await userIdForTelegram(db, telegramId);
    if (!userId) return null;
    const u = await db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { role: true, botNotify: true } });
    const member = await memberForUser(db, userId);
    return { userId, role: (u?.role ?? "member") as Role, botNotify: u?.botNotify ?? true, member, lang: member?.lang ?? DEFAULT_LANG };
  }
  type Who = NonNullable<Awaited<ReturnType<typeof who>>>;
  const keyboardOf = (w: Who, notifyOn = w.botNotify) => memberKeyboard(w.lang, notifyOn, w.role, Boolean(w.member));
  const keyboardForTg = async (telegramId: number) => {
    const w = await who(telegramId);
    return w ? keyboardOf(w) : guestKeyboard();
  };

  async function beginRegistration(chatId: number, from: TgUser) {
    const member = await existingMember(from.id);
    if (member) return send(chatId, t(member.lang).botReg.already, await keyboardForTg(from.id));
    await db
      .insert(schema.botRegistrations)
      .values({ chatId: String(chatId), step: START.step, data: START.data, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: schema.botRegistrations.chatId, set: { step: START.step, data: START.data, updatedAt: Date.now() } });
    const reply = prompt(START);
    return send(chatId, reply.text, markup(reply, DICTS.om.botReg.sharePhone));
  }

  async function continueRegistration(chatId: number, from: TgUser, state: RegState, input: RegInput, tappedMessageId?: number) {
    const removeTappedButtons = () => {
      if (tappedMessageId) api("editMessageReplyMarkup", { chat_id: chatId, message_id: tappedMessageId, reply_markup: { inline_keyboard: [] } });
    };
    const tr = t(state.data.lang === "am" ? "am" : "om");
    const result = regNext(state, input, toEth(new Date()));

    if ("checkStudentId" in result && result.checkStudentId && (await memberByStudentId(db, result.checkStudentId))) {
      const reply = prompt(state, tr.errors.studentIdTaken);
      return send(chatId, reply.text, markup(reply, tr.botReg.sharePhone));
    }

    if (result.state === null) {
      removeTappedButtons();
      const userId = await userForTelegram(db, { id: from.id, name: telegramName(from), username: from.username ?? null });
      const error = await createMember(db, userId, result.submit, toEth(new Date()).year);
      await db.delete(schema.botRegistrations).where(eq(schema.botRegistrations.chatId, String(chatId)));
      if (error === "studentIdTaken") return send(chatId, `${tr.errors.studentIdTaken}\n/register`);
      const created = await memberForUser(db, userId);
      if (error === "alreadyMember") return send(chatId, tr.botReg.already, created ? await keyboardForTg(from.id) : openButton(tr.botReg.openBtn));
      if (created) {
        notify(env, ctx, newRegistrationNotices(await recipientsWithRoles(db, ["members_coordinator"]), {
          id: created.id, name: result.submit.fullName, department: result.submit.department, graduate: result.submit.studyYear === null,
        }, site));
      }
      // The keyboard under the chat replaces the registration buttons from here on
      return send(chatId, result.reply.text, created ? await keyboardForTg(from.id) : openButton(tr.botReg.openBtn));
    }

    await db
      .update(schema.botRegistrations)
      .set({ step: result.state.step, data: result.state.data, updatedAt: Date.now() })
      .where(eq(schema.botRegistrations.chatId, String(chatId)));
    // Toggle buttons: redraw the same message with the new ticks
    if (result.reply.editInPlace && tappedMessageId) {
      return Response.json({ method: "editMessageText", chat_id: chatId, message_id: tappedMessageId, text: result.reply.text, reply_markup: markup(result.reply, tr.botReg.sharePhone) });
    }
    removeTappedButtons();
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
      const w = await who(msg.from.id);
      if (w && (w.member || staffButtons(w.role).finance || staffButtons(w.role).events)) return send(chatId, t(w.lang).botReg.welcomeMember, keyboardOf(w));
      return send(chatId, both((d) => d.botReg.intro), guestKeyboard());
    }

    // Keyboard buttons (checked before an open registration so they always work)
    const tapped = cmd ? null : menuAction(msg.text);
    if (tapped) {
      const w = await who(msg.from.id);
      const reply = (r: BotReply) => send(chatId, r.text, r.reply_markup);
      if (tapped === "register") return beginRegistration(chatId, msg.from);
      if (!w) {
        if (tapped === "open") return send(chatId, both((d) => d.botMenu.pagesTitle), openButton(`${DICTS.om.botReg.openBtn} · ${DICTS.am.botReg.openBtn.replace("📖 ", "")}`));
        return send(chatId, both((d) => d.botReg.intro), guestKeyboard());
      }
      const { lang, member } = w;
      const staff = staffButtons(w.role);
      const denied = () => send(chatId, t(lang).botMenu.notAllowed, keyboardOf(w));
      if (tapped === "unpaid") return staff.finance ? reply(await unpaidReply(db, lang, site)) : denied();
      if (tapped === "attendance") return staff.events ? reply(await attendanceReply(db, lang, site)) : denied();
      if (tapped === "eventDetails") return staff.events ? reply(await eventDetailsReply(db, lang, site)) : denied();
      if (tapped === "pages" || tapped === "open") return reply(pagesReply(lang, site, Boolean(member)));
      if (tapped === "notify") {
        const on = !w.botNotify;
        await db.update(schema.user).set({ botNotify: on }).where(eq(schema.user.id, w.userId));
        return send(chatId, on ? t(lang).botMenu.notifyNowOn : t(lang).botMenu.notifyNowOff, keyboardOf(w, on));
      }
      if (!member) return send(chatId, both((d) => d.botReg.intro), guestKeyboard());
      if (tapped === "next") return reply(await nextReply(db, member, lang));
      if (tapped === "songs") return reply(await songsReply(db, lang, site));
      if (tapped === "pay") return reply(await payReply(db, member, lang, site));
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
  // Staff actions that message many people: first a Yes/No question, then the result in its place
  if (cb?.message && cb.data && /^(f|e|x):/.test(cb.data) && !cb.from.is_bot) {
    api("answerCallbackQuery", { callback_query_id: cb.id });
    const chatId = cb.message.chat.id;
    const messageId = cb.message.message_id;
    const w = await who(cb.from.id);
    if (!w) return ok();
    const m = t(w.lang).botMenu;
    const staff = staffButtons(w.role);
    const edit = (text: string) => Response.json({ method: "editMessageText", chat_id: chatId, message_id: messageId, text });
    const [kind, action, id] = cb.data.split(":");
    if (kind === "x") return edit(m.dropped);
    if (kind === "f" && staff.finance) {
      if (action === "remind") {
        const n = (await remindUnpaid(db, site)).length;
        return send(chatId, m.remindConfirm(n), confirmMarkup(w.lang, "f:remindyes"));
      }
      if (action === "remindyes") {
        const items = await remindUnpaid(db, site);
        await enqueue(db, items);
        ctx.waitUntil(drainOutbox(env, db).catch((e) => console.error("remind failed", e)));
        return edit(m.remindSent(items.length));
      }
    }
    if (kind === "e" && staff.events && id) {
      const event = await db.query.events.findFirst({ where: eq(schema.events.id, id) });
      if (!event) return edit(m.nextNone);
      if (action === "notify") return send(chatId, m.notifyConfirm, confirmMarkup(w.lang, `e:notifyyes:${id}`));
      if (action === "notifyyes") {
        const r = await releaseEvent(env, ctx, db, event);
        const ev = t(w.lang).events;
        return edit(`${ev.notifySent(r.sent)}${r.noGroup ? `\n${ev.noGroup}` : ""}`);
      }
    }
    return edit(m.notAllowed);
  }
  if (cb?.message && cb.data?.startsWith("r:") && !cb.from.is_bot) {
    const chatId = cb.message.chat.id;
    api("answerCallbackQuery", { callback_query_id: cb.id });
    const value = cb.data.slice(2);
    // Old questions lose their buttons so they can't be answered twice (except toggles, redrawn in place)
    if (value === "start") {
      api("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
      return beginRegistration(chatId, cb.from);
    }
    const session = await db.query.botRegistrations.findFirst({ where: eq(schema.botRegistrations.chatId, String(chatId)) });
    if (!session) return ok();
    return continueRegistration(chatId, cb.from, { step: session.step as RegState["step"], data: session.data }, { kind: "choice", value }, cb.message.message_id);
  }

  return ok();
}

export function loader() {
  return new Response("Not found", { status: 404 });
}
