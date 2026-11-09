import { and, asc, eq, gte, or, type SQL } from "drizzle-orm";
import { Form, Link } from "react-router";
import type { Route } from "./+types/songs";
import { PageHead } from "../components/Layout";
import { getDb, schema } from "../db";
import { memberAccess } from "../lib/access.server";
import { contains } from "../lib/search.server";
import { isoToEth, todayIso } from "../lib/dates";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
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
    .select({ id: s.id, title: s.title, lang: s.lang, lyrics: s.lyrics, audio: s.audioKey })
    .from(s)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(s.title))
    .limit(500);
  // Songs chosen for the next event that has any
  const db = getDb(env.DB);
  const next = await db
    .select({ id: schema.events.id, type: schema.events.type, title: schema.events.title, date: schema.events.date })
    .from(schema.events)
    .innerJoin(schema.eventSongs, eq(schema.eventSongs.eventId, schema.events.id))
    .where(and(gte(schema.events.date, todayIso()), eq(schema.events.status, "scheduled")))
    .orderBy(asc(schema.events.date))
    .limit(1)
    .get();
  const nextSongs = next
    ? await db
        .select({ id: schema.songs.id, title: schema.songs.title })
        .from(schema.eventSongs)
        .innerJoin(schema.songs, eq(schema.songs.id, schema.eventSongs.songId))
        .where(eq(schema.eventSongs.eventId, next.id))
        .orderBy(asc(schema.eventSongs.sort))
    : [];
  return {
    allowed: true as const,
    staff,
    q,
    lang,
    next: next ? { ...next, eth: isoToEth(next.date), songs: nextSongs } : null,
    songs: rows.map((r) => ({ id: r.id, title: r.title, lang: r.lang, first: firstLine(r.lyrics), audio: Boolean(r.audio) })),
  };
}

export default function Songs({ loaderData }: Route.ComponentProps) {
  const { lang: uiLang, tr } = useT();
  const s = tr.songs;
  if (!loaderData.allowed) {
    return (
      <section className="page narrow">
        <PageHead back={{ to: "/me", label: tr.nav.myPage }} title={s.title} />
        <p>{tr.feedback.onlyMembers}</p>
      </section>
    );
  }
  const { songs, staff, q, lang, next } = loaderData;
  return (
    <section className="page">
      <PageHead back={{ to: staff ? "/dashboard" : "/me", label: staff ? tr.nav.dashboard : tr.nav.myPage }} title={s.title}
        actions={staff ? <Link to="/songs/new">＋ {s.add}</Link> : undefined} />
      {next && (
        <section className="panel next-songs" aria-labelledby="next-songs-h">
          <h2 id="next-songs-h">{s.nextEvent(eventTitle(uiLang, next), formatEth(uiLang, next.eth))}</h2>
          <ol>
            {next.songs.map((sg) => <li key={sg.id}><Link to={`/songs/${sg.id}`}>{sg.title}</Link></li>)}
          </ol>
        </section>
      )}
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
              {song.audio && <span className="muted" title={s.hasAudio} aria-label={s.hasAudio}>🎧</span>}
              <span className="muted song-first">{song.first}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
