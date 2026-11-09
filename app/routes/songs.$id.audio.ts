import { eq } from "drizzle-orm";
import type { Route } from "./+types/songs.$id.audio";
import { getDb, schema } from "../db";
import { memberAccess } from "../lib/access.server";
import { requirePermission } from "../lib/session.server";
import { AUDIO_TYPES, checkAudio, parseRange } from "../lib/songs";

/** Members-only playback, with byte ranges so the player can seek. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const { allowed } = await memberAccess(request, env, "song:manage");
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  const song = await getDb(env.DB).query.songs.findFirst({ where: eq(schema.songs.id, params.id), columns: { audioKey: true, audioType: true, audioSize: true } });
  if (!song?.audioKey || !song.audioSize) throw new Response("Not found", { status: 404 });

  const size = song.audioSize;
  const range = parseRange(request.headers.get("Range"), size);
  const base = {
    "Content-Type": song.audioType ?? "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  const obj = await env.MEDIA.get(song.audioKey, range ? { range } : undefined);
  if (!obj) throw new Response("Not found", { status: 404 });
  if (!range) return new Response(obj.body, { headers: { ...base, "Content-Length": String(size) } });
  return new Response(obj.body, {
    status: 206,
    headers: { ...base, "Content-Length": String(range.length), "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` },
  });
}

/** Upload or replace the recording: raw request body streamed into R2 (almost no Worker CPU). */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "song:manage");
  const db = getDb(env.DB);
  const song = await db.query.songs.findFirst({ where: eq(schema.songs.id, params.id), columns: { id: true, audioKey: true } });
  if (!song) return Response.json({ error: "notFound" }, { status: 404 });
  const type = request.headers.get("Content-Type");
  const size = Number(request.headers.get("Content-Length"));
  const error = checkAudio(type, size);
  if (error || !request.body) return Response.json({ error: error ?? "fileMissing" }, { status: 400 });

  const key = `songs/${song.id}-${Date.now()}.${AUDIO_TYPES[type!]}`;
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: type! } });
  await db.update(schema.songs).set({ audioKey: key, audioType: type, audioSize: size }).where(eq(schema.songs.id, song.id));
  if (song.audioKey) await env.MEDIA.delete(song.audioKey);
  return Response.json({ ok: true });
}
