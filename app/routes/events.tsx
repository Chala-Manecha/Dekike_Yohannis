import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { AddPanel, Card, PageHead, TabBar } from "../components/Layout";
import type { Route } from "./+types/events";
import { EthDateFields } from "../components/EthDateFields";
import { Field } from "../components/Field";
import { getDb, schema } from "../db";
import { addDaysIso, isoToEth, todayIso } from "../lib/dates";
import { eventFormSchema, ethFieldsToIso } from "../lib/event-form";
import { toEth } from "../lib/ethiopian";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
import { ensureZikrEvents } from "../lib/notify.server";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "event:manage");
  const db = getDb(env.DB);
  await ensureZikrEvents(db);
  const today = todayIso();
  const cols = { id: schema.events.id, type: schema.events.type, title: schema.events.title, date: schema.events.date, status: schema.events.status, time: schema.events.time, place: schema.events.place };
  const upcoming = await db.select(cols).from(schema.events).where(gte(schema.events.date, today)).orderBy(asc(schema.events.date)).limit(30);
  const past = await db
    .select(cols)
    .from(schema.events)
    .where(and(lt(schema.events.date, today), gte(schema.events.date, addDaysIso(today, -90))))
    .orderBy(desc(schema.events.date));
  return { upcoming, past, todayEth: toEth(new Date()) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "event:manage");
  const parsed = eventFormSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success || parsed.data.type === "zikr") return { error: "fixFields" as const };
  const date = ethFieldsToIso(parsed.data.ethYear, parsed.data.ethMonth, parsed.data.ethDay);
  if (!date) return { error: "badDate" as const };
  const { title, description, time, place, type } = parsed.data;
  const [created] = await getDb(env.DB)
    .insert(schema.events)
    .values({ type, title, description, time, place, date, createdBy: user.id })
    .returning({ id: schema.events.id });
  throw redirect(`/events/${created.id}?created=1`);
}

export default function Events({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const e = tr.events;
  const nav = useNavigation();
  const [params] = useSearchParams();
  const show = params.get("show") === "past" ? "past" : "upcoming";
  const items = show === "past" ? loaderData.past : loaderData.upcoming;

  return (
    <section className="page wide">
      <PageHead back={{ to: "/dashboard", label: tr.nav.dashboard }} title={e.title} sub={tr.serviceDept.preparation} />

      <AddPanel label={e.create} open={Boolean(actionData?.error)}>
        {actionData?.error && <p className="form-error" role="alert">{actionData.error === "badDate" ? e.badDate : tr.errors.fixFields}</p>}
        <Form method="post" className="form">
          <fieldset className="field">
            <legend>{e.type}</legend>
            <div className="choices choices--stacked">
              {(["welcome", "farewell", "other"] as const).map((t, i) => (
                <label key={t}>
                  <input type="radio" name="type" value={t} defaultChecked={i === 0} /> {e.types[t]} <small className="muted">· {e.typeHint[t]}</small>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={e.titleLabel} name="title" required />
          <EthDateFields value={loaderData.todayEth} />
          <Field label={e.time} hint={e.timeHint} name="time" />
          <Field label={e.place} hint={tr.optional} name="place" />
          <label className="field"><span>{e.description} <small>{tr.optional}</small></span><textarea name="description" rows={3} /></label>
          <button className="btn btn-primary" disabled={nav.state !== "idle"}>{e.create}</button>
        </Form>
      </AddPanel>

      <TabBar
        active={show}
        tabs={[
          { key: "upcoming", to: "?show=upcoming", label: e.upcoming, icon: "📅", count: loaderData.upcoming.length },
          { key: "past", to: "?show=past", label: e.past, icon: "🗂️", count: loaderData.past.length },
        ]}
      />

      {items.length === 0 ? <Card><p className="muted">{e.none}</p></Card> : (
        <ul className="event-rows">
          {items.map((ev) => {
            const d = isoToEth(ev.date);
            return (
              <li key={ev.id} className={ev.status === "cancelled" ? "is-cancelled" : ""}>
                <Link to={`/events/${ev.id}`} className={`event-row event-row--${ev.type}`}>
                  <span className="event-date"><b>{d.day}</b><small>{tr.months[d.month - 1]}</small></span>
                  <span className="event-main">
                    <strong>{eventTitle(lang, ev)}</strong>
                    <span className="muted small">{e.types[ev.type]}{ev.time ? ` · ${ev.time}` : ""}{ev.place ? ` · ${ev.place}` : ""}</span>
                  </span>
                  {ev.status === "cancelled" ? <span className="pill pill--rejected">{e.cancelled}</span> : <span className="event-go" aria-hidden="true">›</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
