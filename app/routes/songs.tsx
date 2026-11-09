import { and, asc, eq, or, type SQL } from "drizzle-orm";
import { Form, Link } from "react-router";
import type { Route } from "./+types/songs";
import { getDb, schema } from "../db";
import { memberAccess } from "../lib/access.server";
import { contains } from "../lib/search.server";
import { firstLine, SONG_LANGS, type SongLang } from "../lib/songs";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const { staff, allowed } = await memberAccess(request, env, "song:manage");
  if (!allowed) return { allowed: false as const };
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const langParam = url.searchParams.get("lang") ?? "";
  const lang = (SONG_LANGS as readonly string[]).includes(langParam) ? (langParam as SongLang) : "";
  const s = schema.songs;
  const where: SQL[] = [];
  if (q) where.push(or(contains(s.title, q), contains(s.lyrics, q))!);
  if (lang) where.push(eq(s.lang, lang));
  const rows = await getDb(env.DB)
    .select({ id: s.id, title: s.title, lang: s.lang, lyrics: s.lyrics })
    .from(s)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(s.title))
    .limit(500);
  return { allowed: true as const, staff, q, lang, songs: rows.map((r) => ({ id: r.id, title: r.title, lang: r.lang, first: firstLine(r.lyrics) })) };
}

export default function Songs({ loaderData }: Route.ComponentProps) {
  const { tr } = useT();
  const s = tr.songs;
  if (!loaderData.allowed) {
    return (
      <section className="page narrow">
        <h1>{s.title}</h1>
        <p>{tr.feedback.onlyMembers}</p>
      </section>
    );
  }
  const { songs, staff, q, lang } = loaderData;
  return (
    <section className="page">
      <h1>{s.title}</h1>
      {staff && <p><Link to="/songs/new" className="btn btn-primary btn-sm">{s.add}</Link></p>}
      <Form method="get" className="filters" role="search">
        <input type="search" name="q" defaultValue={q} placeholder={s.search} aria-label={s.search} />
        <select name="lang" defaultValue={lang} aria-label={s.lang}>
          <option value="">{s.allLangs}</option>
          {SONG_LANGS.map((l) => <option key={l} value={l}>{s.langs[l]}</option>)}
        </select>
        <button className="btn btn-quiet btn-sm">{tr.materials.filter}</button>
      </Form>
      {songs.length === 0 ? <p className="muted">{s.none}</p> : (
        <ul className="song-list">
          {songs.map((song) => (
            <li key={song.id}>
              <Link to={`/songs/${song.id}`}><strong>{song.title}</strong></Link>
              <span className="badge">{s.langs[song.lang]}</span>
              <span className="muted song-first">{song.first}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
