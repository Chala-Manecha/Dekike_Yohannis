import { desc, eq } from "drizzle-orm";
import type { Route } from "./+types/gallery";
import { GROUP } from "../config";
import { getDb, schema } from "../db";
import { isoToEth } from "../lib/dates";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
import { photoUrl } from "../lib/photos";
import { useT } from "../lib/use-t";

export function meta() {
  return [{ title: `Gallery · ${GROUP.nameEn}` }];
}

/** Public: every event photo, newest event first. */
export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context.cloudflare.env.DB);
  const rows = await db
    .select({
      id: schema.photos.id,
      width: schema.photos.width,
      height: schema.photos.height,
      caption: schema.photos.caption,
      eventId: schema.events.id,
      type: schema.events.type,
      title: schema.events.title,
      date: schema.events.date,
    })
    .from(schema.photos)
    .innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
    .orderBy(desc(schema.events.date), desc(schema.photos.createdAt))
    .limit(600);

  const groups: { eventId: string; type: (typeof rows)[number]["type"]; title: string | null; eth: ReturnType<typeof isoToEth>; photos: typeof rows }[] = [];
  for (const r of rows) {
    let g = groups.at(-1);
    if (!g || g.eventId !== r.eventId) {
      g = { eventId: r.eventId, type: r.type, title: r.title, eth: isoToEth(r.date), photos: [] };
      groups.push(g);
    }
    g.photos.push(r);
  }
  return { groups };
}

export default function Gallery({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const { groups } = loaderData;
  return (
    <section className="page">
      <h1>{tr.gallery.title}</h1>
      {groups.length === 0 && <p className="muted">{tr.gallery.empty}</p>}
      {groups.map((g) => (
        <section key={g.eventId} className="gallery-group" aria-labelledby={`g-${g.eventId}`}>
          <h2 id={`g-${g.eventId}`}>
            {eventTitle(lang, g)} <small className="muted">{formatEth(lang, g.eth)}</small>
          </h2>
          <ul className="photo-grid">
            {g.photos.map((p) => (
              <li key={p.id}>
                <a href={photoUrl(p.id, "full")} target="_blank" rel="noreferrer">
                  <img src={photoUrl(p.id, "thumb")} alt={p.caption ?? eventTitle(lang, g)} width={p.width} height={p.height} loading="lazy" decoding="async" />
                </a>
                {p.caption && <span className="photo-cap">{p.caption}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
