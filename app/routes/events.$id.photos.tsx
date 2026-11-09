import { and, desc, eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/events.$id.photos";
import { PhotoUploader } from "../components/PhotoUploader";
import { getDb, schema } from "../db";
import { isoToEth } from "../lib/dates";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
import { photoKey, photoUrl } from "../lib/photos";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "photo:manage");
  const db = getDb(env.DB);
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, params.id) });
  if (!event) throw new Response("Not found", { status: 404 });
  const photos = await db.select().from(schema.photos).where(eq(schema.photos.eventId, event.id)).orderBy(desc(schema.photos.createdAt));
  return { event, eth: isoToEth(event.date), photos };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "photo:manage");
  const db = getDb(env.DB);
  const form = await request.formData();
  const photoId = String(form.get("id"));
  const where = and(eq(schema.photos.id, photoId), eq(schema.photos.eventId, params.id));
  const photo = await db.query.photos.findFirst({ where });
  if (!photo) throw new Response("Not found", { status: 404 });

  switch (form.get("intent")) {
    case "feature":
      await db.update(schema.photos).set({ featured: form.get("featured") === "1" }).where(where);
      return { ok: true };
    case "caption": {
      const caption = String(form.get("caption") ?? "").trim().slice(0, 140) || null;
      await db.update(schema.photos).set({ caption }).where(where);
      return { ok: true };
    }
    case "delete":
      await db.delete(schema.photos).where(where);
      await env.MEDIA.delete([photoKey(photo.id, "full"), photoKey(photo.id, "thumb")]);
      return { ok: true };
    default:
      throw new Response("Bad request", { status: 400 });
  }
}

export default function EventPhotos({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const g = tr.gallery;
  const busy = useNavigation().state !== "idle";
  const { event, eth, photos } = loaderData;

  return (
    <section className="page">
      <p><Link to={`/events/${event.id}`}>← {eventTitle(lang, event)}</Link></p>
      <h1>{g.manageTitle}</h1>
      <p className="lead-line">{eventTitle(lang, event)} · {formatEth(lang, eth)}</p>

      <PhotoUploader
        uploadUrl={`/events/${event.id}/photos/upload`}
        labels={{ choose: g.choose, hint: g.uploadHint, progress: g.progress, failed: g.failed }}
      />

      {photos.length === 0 ? (
        <p className="muted">{g.noPhotos}</p>
      ) : (
        <ul className="photo-admin">
          {photos.map((p) => (
            <li key={p.id} className={p.featured ? "is-featured" : ""}>
              <a href={photoUrl(p.id, "full")} target="_blank" rel="noreferrer">
                <img src={photoUrl(p.id, "thumb")} alt={p.caption ?? ""} width={p.width} height={p.height} loading="lazy" />
              </a>
              <Form method="post" className="photo-caption">
                <input type="hidden" name="intent" value="caption" />
                <input type="hidden" name="id" value={p.id} />
                <input name="caption" defaultValue={p.caption ?? ""} placeholder={g.caption} maxLength={140} aria-label={g.caption} />
                <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.save}</button>
              </Form>
              <div className="photo-actions">
                <Form method="post">
                  <input type="hidden" name="intent" value="feature" />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="featured" value={p.featured ? "0" : "1"} />
                  <button className={`btn btn-sm ${p.featured ? "btn-primary" : "btn-quiet"}`} aria-pressed={p.featured} disabled={busy}>
                    {p.featured ? g.onHome : g.showOnHome}
                  </button>
                </Form>
                <Form method="post" onSubmit={(e) => { if (!confirm(g.confirmDelete)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={p.id} />
                  <button className="link-btn danger" disabled={busy}>{tr.remove}</button>
                </Form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
