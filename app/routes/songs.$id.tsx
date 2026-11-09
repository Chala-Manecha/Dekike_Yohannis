import { eq } from "drizzle-orm";
import { Form, Link, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/songs.$id";
import { SongForm } from "../components/SongForm";
import { getDb, schema } from "../db";
import { memberAccess } from "../lib/access.server";
import { requirePermission } from "../lib/session.server";
import { songSchema } from "../lib/songs";
import { useT } from "../lib/use-t";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const { staff, allowed } = await memberAccess(request, env, "song:manage");
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  const song = await getDb(env.DB).query.songs.findFirst({ where: eq(schema.songs.id, params.id) });
  if (!song) throw new Response("Not found", { status: 404 });
  return { song: { id: song.id, title: song.title, lang: song.lang, lyrics: song.lyrics }, staff };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "song:manage");
  const db = getDb(env.DB);
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    await db.delete(schema.songs).where(eq(schema.songs.id, params.id));
    throw redirect("/songs");
  }
  const parsed = songSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { errors };
  }
  await db.update(schema.songs).set({ ...parsed.data, updatedBy: user.id }).where(eq(schema.songs.id, params.id));
  throw redirect(`/songs/${params.id}`);
}

/** Large, readable lyrics for singing from a phone. Staff edit with ?edit. */
export default function Song({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const s = tr.songs;
  const { song, staff } = loaderData;
  const [params] = useSearchParams();
  const editing = staff && (params.has("edit") || Boolean(actionData?.errors));

  return (
    <section className="page narrow">
      <p><Link to="/songs">← {s.title}</Link></p>
      {editing ? (
        <>
          <h1>{s.edit}</h1>
          <SongForm song={song} errors={actionData?.errors} />
          <Form method="post" className="danger-zone" onSubmit={(e) => { if (!confirm(s.confirmDelete)) e.preventDefault(); }}>
            <button className="btn btn-quiet btn-sm" name="intent" value="delete">{tr.remove}</button>
          </Form>
        </>
      ) : (
        <article className="song">
          <h1>{song.title}</h1>
          <p className="muted">{s.langs[song.lang]}</p>
          <div className="lyrics" lang={song.lang === "am" || song.lang === "gez" ? "am" : song.lang === "om" ? "om" : undefined}>{song.lyrics}</div>
          {staff && <p><Link to="?edit" className="btn btn-quiet btn-sm">{s.edit}</Link></p>}
        </article>
      )}
    </section>
  );
}
