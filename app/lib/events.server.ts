import { asc, eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { planEventRelease } from "./notify";
import { drainOutbox, enqueue, loadPlanMembers } from "./notify.server";

/**
 * "Notify members" for one event: group post + a private note to every active member
 * (website button and the bot's 📣 button both use this).
 */
export async function releaseEvent(env: Env, ctx: ExecutionContext, db: Db, event: typeof schema.events.$inferSelect) {
  const duties = await db
    .select({ duty: schema.eventDuties.duty, memberId: schema.members.id, name: schema.members.fullName })
    .from(schema.eventDuties)
    .innerJoin(schema.members, eq(schema.members.id, schema.eventDuties.memberId))
    .where(eq(schema.eventDuties.eventId, event.id))
    .orderBy(asc(schema.eventDuties.createdAt));
  const songs = await db
    .select({ title: schema.songs.title })
    .from(schema.eventSongs)
    .innerJoin(schema.songs, eq(schema.songs.id, schema.eventSongs.songId))
    .where(eq(schema.eventSongs.eventId, event.id))
    .orderBy(asc(schema.eventSongs.sort));
  const groupChatId = env.TELEGRAM_GROUP_CHAT_ID || null;
  const items = planEventRelease({
    event,
    duties,
    songs: songs.map((s) => s.title),
    members: await loadPlanMembers(db),
    groupChatId,
    stamp: new Date().toISOString().slice(0, 16),
  });
  await enqueue(db, items);
  ctx.waitUntil(drainOutbox(env, db).catch((e) => console.error("release send failed", e)));
  return { sent: items.length, noGroup: !groupChatId };
}
