import { eq } from "drizzle-orm";
import type { Route } from "./+types/events.$id.photos.upload";
import { getDb, schema } from "../db";
import { checkPhotoUpload, photoKey } from "../lib/photos";
import { requirePermission } from "../lib/session.server";

/** One photo per request (full + thumbnail), sent by PhotoUploader. Returns JSON. */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "photo:manage");
  const db = getDb(env.DB);
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, params.id), columns: { id: true } });
  if (!event) return Response.json({ error: "notFound" }, { status: 404 });

  const form = await request.formData();
  const checked = checkPhotoUpload({
    photo: form.get("photo"),
    thumb: form.get("thumb"),
    width: form.get("width"),
    height: form.get("height"),
    caption: form.get("caption"),
  });
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
  const { full, thumb, width, height, caption } = checked.value;

  const id = crypto.randomUUID();
  await env.MEDIA.put(photoKey(id, "full"), full.stream(), { httpMetadata: { contentType: full.type } });
  await env.MEDIA.put(photoKey(id, "thumb"), thumb.stream(), { httpMetadata: { contentType: thumb.type } });
  try {
    await db.insert(schema.photos).values({ id, eventId: event.id, width, height, caption, uploadedBy: user.id });
  } catch (e) {
    await env.MEDIA.delete([photoKey(id, "full"), photoKey(id, "thumb")]);
    throw e;
  }
  return Response.json({ id });
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
