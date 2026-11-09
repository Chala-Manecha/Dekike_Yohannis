import { asc, desc, eq } from "drizzle-orm";
import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { loader as rootLoader } from "../root";
import { GROUP, PLACES } from "../config";
import { getDb, schema } from "../db";
import { daysBetween, isoToEth, todayIso } from "../lib/dates";
import { homeWindow } from "../lib/events";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
import { HOME_GALLERY_MAX, marqueeSeconds, photoUrl } from "../lib/photos";
import { scheduledEvents } from "../lib/notify.server";
import { getDues } from "../lib/settings.server";
import { useT } from "../lib/use-t";

export function meta() {
  return [{ title: GROUP.nameEn }, { name: "description", content: "CS, IT and EE monthly zikr of St. John the Baptist" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context.cloudflare.env.DB);
  const today = todayIso();
  const { from, to } = homeWindow(today);
  const [events, photos] = await Promise.all([
    scheduledEvents(db, from, to),
    db
      .select({ id: schema.photos.id, width: schema.photos.width, height: schema.photos.height, caption: schema.photos.caption, type: schema.events.type, title: schema.events.title })
      .from(schema.photos)
      .innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
      .where(eq(schema.photos.featured, true))
      .orderBy(desc(schema.photos.createdAt))
      .limit(HOME_GALLERY_MAX),
  ]);
  const contacts = await db
    .select({ id: schema.contacts.id, name: schema.contacts.name, role: schema.contacts.role, phone: schema.contacts.phone, telegram: schema.contacts.telegram })
    .from(schema.contacts)
    .orderBy(asc(schema.contacts.sort), asc(schema.contacts.name));
  return {
    photos,
    contacts,
    dues: await getDues(db),
    events: events.map((e) => ({ ...e, eth: isoToEth(e.date), daysLeft: daysBetween(today, e.date) })),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const signedIn = Boolean(useRouteLoaderData<typeof rootLoader>("root")?.user);
  const { events, dues, photos, contacts } = loaderData;
  const h = tr.home;

  return (
    <div className="home">
      <section className="hero">
        <p className="hero-uni">{tr.places.university}</p>
        <h1>{tr.groupName}</h1>
        <p className="hero-tagline">{h.intro}</p>
        <div className="hero-actions">
          {!signedIn && <Link to="/register" className="btn btn-primary">{h.registerCta}</Link>}
          <a href={GROUP.telegramGroup} className="btn btn-quiet" target="_blank" rel="noreferrer">{h.joinTelegram}</a>
        </div>
      </section>

      <div className="tilet" aria-hidden="true" />

      <section className="page" aria-labelledby="upcoming-h">
        <h2 id="upcoming-h">{h.upcoming}</h2>
        {events.length === 0 ? (
          <p className="muted">{h.noUpcoming}</p>
        ) : (
          <ul className="event-cards">
            {events.map((e) => (
              <li key={e.id} className={`event-card event-card--${e.type}`}>
                <span className="event-when">{e.daysLeft === 0 ? h.today : h.inDays(e.daysLeft)}</span>
                {e.title && <span className={`badge badge--${e.type}`}>{tr.events.types[e.type]}</span>}
                <h3>{eventTitle(lang, e)}</h3>
                <p>{formatEth(lang, e.eth)}{e.time ? ` · ${e.time}` : ""}</p>
                {e.place && <p className="muted">{e.place}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {photos.length > 0 && (
        <section className="home-gallery" aria-labelledby="gallery-h">
          <div className="home-gallery-head">
            <h2 id="gallery-h">{tr.gallery.title}</h2>
            <Link to="/gallery">{tr.gallery.seeAll} →</Link>
          </div>
          <div className="marquee">
            <div className="marquee-track" style={{ animationDuration: `${marqueeSeconds(photos.length)}s` }}>
              {[0, 1].map((copy) => (
                // The second copy makes the loop seamless; screen readers and keyboards skip it.
                <ul key={copy} className="marquee-list" aria-hidden={copy === 1 || undefined}>
                  {photos.map((p) => (
                    <li key={p.id}>
                      <Link to="/gallery" tabIndex={copy === 1 ? -1 : undefined}>
                        <img src={photoUrl(p.id, "thumb")} alt={copy === 1 ? "" : p.caption ?? eventTitle(lang, p)} width={p.width} height={p.height} loading="lazy" decoding="async" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="page home-facts">
        <div className="fact">
          <h2>{h.duesTitle}</h2>
          <p>{h.duesStudent(dues.student)}</p>
          <p>{h.duesGraduate(dues.graduate)}</p>
        </div>
        <div className="fact">
          <h2>{tr.places.title}</h2>
          <p className="place">
            <span className="muted small">{tr.places.weMeetAt}</span>
            <strong>{tr.places.church}</strong>
            <a href={PLACES.churchMap} target="_blank" rel="noreferrer">📍 {tr.places.openMap}</a>
          </p>
          <p className="place">
            <span className="muted small">{tr.places.weStudyAt}</span>
            <strong>{tr.places.university}</strong>
            <a href={PLACES.universityMap} target="_blank" rel="noreferrer">📍 {tr.places.openMap}</a>
          </p>
        </div>
        {contacts.length > 0 && (
          <div className="fact" id="contact">
            <h2>{tr.contacts.title}</h2>
            <ul className="contact-list">
              {contacts.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong>{c.role && <span className="muted"> · {c.role}</span>}
                  <div className="contact-ways">
                    {c.phone && <a href={`tel:${c.phone}`}>📞 {c.phone}</a>}
                    {c.telegram && <a href={`https://t.me/${c.telegram}`} target="_blank" rel="noreferrer">✈️ @{c.telegram}</a>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
