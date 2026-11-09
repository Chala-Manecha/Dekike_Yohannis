import { asc, desc, eq } from "drizzle-orm";
import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { loader as rootLoader } from "../root";
import { GROUP, PLACES } from "../config";
import { getDb, schema } from "../db";
import { addDaysIso, daysBetween, isoToEth, todayIso } from "../lib/dates";
import { homeWindow } from "../lib/events";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
import { HOME_GALLERY_MAX, marqueeSeconds, photoUrl } from "../lib/photos";
import { scheduledEvents } from "../lib/notify.server";
import { getDues } from "../lib/settings.server";
import { useT } from "../lib/use-t";
import { SERVICE_DEPARTMENTS } from "../lib/permissions";

export function meta() {
  return [{ title: GROUP.nameEn }, { name: "description", content: "CS, IT and EE monthly zikr of St. John the Baptist" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context.cloudflare.env.DB);
  const today = todayIso();
  const { from, to } = homeWindow(today);
  const [events, photos, ahead] = await Promise.all([
    scheduledEvents(db, from, to),
    db
      .select({ id: schema.photos.id, width: schema.photos.width, height: schema.photos.height, caption: schema.photos.caption, type: schema.events.type, title: schema.events.title })
      .from(schema.photos)
      .innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
      .where(eq(schema.photos.featured, true))
      .orderBy(desc(schema.photos.createdAt))
      .limit(HOME_GALLERY_MAX),
    // The next zikr, shown in the hero even before the 3-day window
    scheduledEvents(db, today, addDaysIso(today, 70)),
  ]);
  const nextZikr = ahead.find((e) => e.type === "zikr") ?? null;
  const contacts = await db
    .select({ id: schema.contacts.id, name: schema.contacts.name, role: schema.contacts.role, phone: schema.contacts.phone, telegram: schema.contacts.telegram })
    .from(schema.contacts)
    .orderBy(asc(schema.contacts.sort), asc(schema.contacts.name));
  return {
    photos,
    contacts,
    next: nextZikr ? { ...nextZikr, eth: isoToEth(nextZikr.date), daysLeft: daysBetween(today, nextZikr.date) } : null,
    dues: await getDues(db),
    events: events.map((e) => ({ ...e, eth: isoToEth(e.date), daysLeft: daysBetween(today, e.date) })),
  };
}

const DEPT_ICONS: Record<(typeof SERVICE_DEPARTMENTS)[number], string> = {
  members: "🤝",
  finance: "💰",
  songs: "🎵",
  property: "📦",
  preparation: "🕯️",
  education: "📚",
};

export default function Home({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const signedIn = Boolean(useRouteLoaderData<typeof rootLoader>("root")?.user);
  const { events, dues, photos, contacts, next } = loaderData;
  const h = tr.home;
  const days = (n: number) => (n === 0 ? h.today : h.inDays(n));

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-hero-text">
            <p className="hero-pills">
              <a href={PLACES.churchMap} target="_blank" rel="noreferrer">⛪ {tr.places.church}</a>
              <a href={PLACES.universityMap} target="_blank" rel="noreferrer">🎓 {tr.places.university}</a>
            </p>
            <h1>{tr.groupName}</h1>
            <p className="hero-sub">{tr.groupSub}</p>
            <p className="hero-tagline">{h.intro}</p>
            <div className="hero-actions">
              {signedIn ? (
                <Link to="/dashboard" className="btn btn-gold">{tr.nav.myPage}</Link>
              ) : (
                <>
                  <Link to="/register" className="btn btn-gold">{h.registerCta}</Link>
                  <Link to="/login" className="btn btn-outline-light">{tr.nav.signIn}</Link>
                </>
              )}
              <a href={GROUP.telegramGroup} className="btn btn-outline-light" target="_blank" rel="noreferrer">✈️ Telegram</a>
            </div>
          </div>
          {next && (
            <aside className="next-zikr" aria-label={h.nextZikr}>
              <span className="next-zikr-label">{h.nextZikr}</span>
              <strong className="next-zikr-day">{next.eth.day}</strong>
              <span className="next-zikr-month">{tr.months[next.eth.month - 1]} {next.eth.year}</span>
              <span className="next-zikr-left">{days(next.daysLeft)}</span>
              {(next.time || next.place) && <span className="next-zikr-where">{[next.time, next.place].filter(Boolean).join(" · ")}</span>}
            </aside>
          )}
        </div>
      </section>
      <div className="tilet" aria-hidden="true" />

      {events.length > 0 && (
        <section className="home-section" aria-labelledby="upcoming-h">
          <h2 id="upcoming-h" className="section-title">{h.upcoming}</h2>
          <ul className="event-cards">
            {events.map((e) => (
              <li key={e.id} className={`event-card event-card--${e.type}`}>
                <span className="event-when">{days(e.daysLeft)}</span>
                {e.title && <span className={`badge badge--${e.type}`}>{tr.events.types[e.type]}</span>}
                <h3>{eventTitle(lang, e)}</h3>
                <p>{formatEth(lang, e.eth)}{e.time ? ` · ${e.time}` : ""}</p>
                {e.place && <p className="muted">{e.place}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {photos.length > 0 && (
        <section className="home-gallery" aria-labelledby="gallery-h">
          <div className="home-gallery-head">
            <h2 id="gallery-h" className="section-title">{tr.gallery.title}</h2>
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

      <section className="home-section home-cards">
        <article className="info-card">
          <h2>💳 {h.duesTitle}</h2>
          <div className="dues">
            <div><strong>{dues.student}</strong><span>{tr.birr} · {tr.dashboard.students}</span></div>
            <div><strong>{dues.graduate}</strong><span>{tr.birr} · {tr.dashboard.graduates}</span></div>
          </div>
          <p className="muted small">{h.duesNote}</p>
        </article>

        <article className="info-card">
          <h2>📍 {tr.places.title}</h2>
          <div className="place-row">
            <div><span className="muted small">{tr.places.weMeetAt}</span><strong>{tr.places.church}</strong></div>
            <a className="btn btn-quiet btn-sm" href={PLACES.churchMap} target="_blank" rel="noreferrer">{tr.places.openMap}</a>
          </div>
          <div className="place-row">
            <div><span className="muted small">{tr.places.weStudyAt}</span><strong>{tr.places.university}</strong></div>
            <a className="btn btn-quiet btn-sm" href={PLACES.universityMap} target="_blank" rel="noreferrer">{tr.places.openMap}</a>
          </div>
        </article>

        <article className="info-card" id="contact">
          <h2>📞 {tr.contacts.title}</h2>
          {contacts.length === 0 ? (
            <p className="muted">
              <a href={GROUP.telegramGroup} target="_blank" rel="noreferrer">{h.joinTelegram}</a>
            </p>
          ) : (
            <ul className="contact-list">
              {contacts.map((c) => (
                <li key={c.id}>
                  <div><strong>{c.name}</strong>{c.role && <span className="muted small"> · {c.role}</span>}</div>
                  <div className="contact-ways">
                    {c.phone && <a href={`tel:${c.phone}`} className="contact-btn">📞 {c.phone}</a>}
                    {c.telegram && <a href={`https://t.me/${c.telegram}`} target="_blank" rel="noreferrer" className="contact-btn">✈️ @{c.telegram}</a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="home-section serve" aria-labelledby="serve-h">
        <h2 id="serve-h" className="section-title">{h.serveTitle}</h2>
        <p className="muted">{h.serveIntro}</p>
        <ul className="serve-grid">
          {SERVICE_DEPARTMENTS.map((d) => (
            <li key={d}><span aria-hidden="true">{DEPT_ICONS[d]}</span>{tr.serviceDept[d]}</li>
          ))}
        </ul>
        {!signedIn && <p><Link to="/register" className="btn btn-primary">{h.registerCta}</Link></p>}
      </section>
    </div>
  );
}
