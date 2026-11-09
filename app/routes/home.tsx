import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { loader as rootLoader } from "../root";
import { GROUP } from "../config";
import { getDb } from "../db";
import { daysBetween, isoToEth, todayIso } from "../lib/dates";
import { homeWindow } from "../lib/events";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
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
  const events = await scheduledEvents(db, from, to);
  return {
    dues: await getDues(db),
    events: events.map((e) => ({ ...e, eth: isoToEth(e.date), daysLeft: daysBetween(today, e.date) })),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const signedIn = Boolean(useRouteLoaderData<typeof rootLoader>("root")?.user);
  const { events, dues } = loaderData;
  const h = tr.home;

  return (
    <div className="home">
      <section className="hero">
        <p className="hero-uni">{tr.groupSub}</p>
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

      <section className="page home-facts">
        <div className="fact">
          <h2>{h.duesTitle}</h2>
          <p>{h.duesStudent(dues.student)}</p>
          <p>{h.duesGraduate(dues.graduate)}</p>
        </div>
      </section>
    </div>
  );
}
