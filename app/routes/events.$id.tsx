import { and, asc, eq, gt, lt, max } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/events.$id";
import { EthDateFields } from "../components/EthDateFields";
import { Field } from "../components/Field";
import { getDb, schema } from "../db";
import { isoToEth } from "../lib/dates";
import { eventFormSchema, ethFieldsToIso } from "../lib/event-form";
import { formatEth } from "../lib/i18n";
import { eventTitle, planReschedule } from "../lib/notify";
import { enqueue, loadPlanMembers } from "../lib/notify.server";
import { can, canWorkTask, departmentOf, SERVICE_DEPARTMENTS, type ServiceDepartment } from "../lib/permissions";
import { requireUser } from "../lib/session.server";
import { useT } from "../lib/use-t";

async function access(request: Request, env: Env) {
  const user = await requireUser(request, env);
  const manage = can(user.role, "event:manage");
  if (!manage && !can(user.role, "task:view")) throw new Response("Forbidden", { status: 403 });
  return {
    user,
    manage,
    program: can(user.role, "program:manage"),
    assign: can(user.role, "task:assign"),
    myDept: departmentOf(user.role),
  };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const a = await access(request, env);
  const db = getDb(env.DB);
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, params.id) });
  if (!event) throw new Response("Not found", { status: 404 });
  const program = await db.select().from(schema.eventProgram).where(eq(schema.eventProgram.eventId, event.id)).orderBy(asc(schema.eventProgram.sort));
  const tasks = await db.select().from(schema.eventTasks).where(eq(schema.eventTasks.eventId, event.id)).orderBy(asc(schema.eventTasks.createdAt));
  const visibleTasks = a.manage || a.assign ? tasks : tasks.filter((t) => t.department === a.myDept);
  const songsManage = can(a.user.role, "song:manage");
  const eventSongs = await db
    .select({ id: schema.eventSongs.id, songId: schema.songs.id, title: schema.songs.title, sort: schema.eventSongs.sort })
    .from(schema.eventSongs)
    .innerJoin(schema.songs, eq(schema.songs.id, schema.eventSongs.songId))
    .where(eq(schema.eventSongs.eventId, event.id))
    .orderBy(asc(schema.eventSongs.sort));
  const allSongs = songsManage
    ? await db.select({ id: schema.songs.id, title: schema.songs.title }).from(schema.songs).orderBy(asc(schema.songs.title)).limit(1000)
    : [];
  return {
    event,
    eth: isoToEth(event.date),
    program,
    tasks: visibleTasks.map((t) => ({ ...t, canWork: canWorkTask(a.user.role, t.department) })),
    perms: { manage: a.manage, program: a.program, assign: a.assign, photos: can(a.user.role, "photo:manage"), songs: songsManage },
    eventSongs,
    allSongs: allSongs.filter((x) => !eventSongs.some((e) => e.songId === x.id)),
    created: new URL(request.url).searchParams.has("created"),
  };
}

const partSchema = z.object({ part: z.string().trim().min(1).max(120), person: z.string().trim().max(120).optional() });
const taskSchema = z.object({ department: z.enum(SERVICE_DEPARTMENTS), task: z.string().trim().min(2).max(300) });

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const a = await access(request, env);
  const db = getDb(env.DB);
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, params.id) });
  if (!event) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const intent = form.get("intent");
  const deny = () => {
    throw new Response("Forbidden", { status: 403 });
  };

  if (intent === "update") {
    if (!a.manage) deny();
    const parsed = eventFormSchema.safeParse({ ...Object.fromEntries(form), type: event.type });
    if (!parsed.success) return { error: "fixFields" as const };
    const date = ethFieldsToIso(parsed.data.ethYear, parsed.data.ethMonth, parsed.data.ethDay);
    if (!date) return { error: "badDate" as const };
    const { title, description, time, place } = parsed.data;
    await db.update(schema.events).set({ title, description, time, place, date }).where(eq(schema.events.id, event.id));
    if (date !== event.date && event.status === "scheduled") {
      const members = await loadPlanMembers(db);
      await enqueue(db, planReschedule({ ...event, title, time, place, date }, members, env.TELEGRAM_GROUP_CHAT_ID || null));
    }
    return { message: "updated" as const };
  }

  if (intent === "cancel") {
    if (!a.manage) deny();
    await db.update(schema.events).set({ status: "cancelled" }).where(eq(schema.events.id, event.id));
    return { message: "cancelled" as const };
  }

  if (intent === "addPart") {
    if (!a.program) deny();
    const parsed = partSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "fixFields" as const };
    const [{ top }] = await db.select({ top: max(schema.eventProgram.sort) }).from(schema.eventProgram).where(eq(schema.eventProgram.eventId, event.id));
    await db.insert(schema.eventProgram).values({ eventId: event.id, sort: (top ?? 0) + 1, part: parsed.data.part, person: parsed.data.person || null });
    return { ok: true };
  }

  if (intent === "removePart") {
    if (!a.program) deny();
    await db.delete(schema.eventProgram).where(eq(schema.eventProgram.id, String(form.get("id"))));
    return { ok: true };
  }

  if (intent === "addTask") {
    if (!a.assign) deny();
    const parsed = taskSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "fixFields" as const };
    await db.insert(schema.eventTasks).values({ eventId: event.id, ...parsed.data, createdBy: a.user.id });
    return { ok: true };
  }

  if (intent === "addSong" || intent === "removeSong" || intent === "moveUp" || intent === "moveDown") {
    if (!can(a.user.role, "song:manage")) deny();
    const es = schema.eventSongs;
    if (intent === "addSong") {
      const songId = String(form.get("songId") ?? "");
      if (!(await db.query.songs.findFirst({ where: eq(schema.songs.id, songId), columns: { id: true } }))) return { error: "fixFields" as const };
      const [{ top }] = await db.select({ top: max(es.sort) }).from(es).where(eq(es.eventId, event.id));
      await db.insert(es).values({ eventId: event.id, songId, sort: (top ?? 0) + 1 }).onConflictDoNothing();
      return { ok: true };
    }
    const row = await db.query.eventSongs.findFirst({ where: and(eq(es.id, String(form.get("id"))), eq(es.eventId, event.id)) });
    if (!row) throw new Response("Not found", { status: 404 });
    if (intent === "removeSong") {
      await db.delete(es).where(eq(es.id, row.id));
      return { ok: true };
    }
    // Swap with the neighbour above or below
    const up = intent === "moveUp";
    const neighbour = await db.query.eventSongs.findFirst({
      where: and(eq(es.eventId, event.id), up ? lt(es.sort, row.sort) : gt(es.sort, row.sort)),
      orderBy: (t, { asc: a2, desc: d2 }) => [up ? d2(t.sort) : a2(t.sort)],
    });
    if (neighbour) {
      await db.batch([
        db.update(es).set({ sort: neighbour.sort }).where(eq(es.id, row.id)),
        db.update(es).set({ sort: row.sort }).where(eq(es.id, neighbour.id)),
      ]);
    }
    return { ok: true };
  }

  if (intent === "doneTask") {
    const task = await db.query.eventTasks.findFirst({ where: eq(schema.eventTasks.id, String(form.get("id"))) });
    if (!task || task.eventId !== event.id) throw new Response("Not found", { status: 404 });
    if (!canWorkTask(a.user.role, task.department)) deny();
    await db.update(schema.eventTasks).set({ status: "done", doneBy: a.user.id, doneAt: new Date() }).where(eq(schema.eventTasks.id, task.id));
    return { ok: true };
  }

  throw new Response("Bad request", { status: 400 });
}

export default function EventDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const e = tr.events;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { event, eth, program, tasks, perms, eventSongs, allSongs } = loaderData;
  const msg = actionData && "message" in actionData ? actionData.message : null;
  const err = actionData && "error" in actionData ? actionData.error : null;

  return (
    <section className="page">
      <p><Link to={perms.manage ? "/events" : "/tasks"}>← {perms.manage ? e.title : tr.tasks.title}</Link></p>
      <p><span className={`badge badge--${event.type}`}>{e.types[event.type]}</span></p>
      <h1>{eventTitle(lang, event)}</h1>
      <p className="lead-line">
        {formatEth(lang, eth)}{event.time ? ` · ${event.time}` : ""}{event.place ? ` · ${event.place}` : ""}
        {event.status === "cancelled" && <span className="pill pill--rejected"> {e.cancelled}</span>}
      </p>
      {event.type === "zikr" && event.dueYear && event.dueMonth && (
        <p className="muted">{e.dueMonth(formatEth(lang, { year: event.dueYear, month: event.dueMonth }))}</p>
      )}
      {event.description && <p>{event.description}</p>}
      {perms.photos && <p><Link to={`/events/${event.id}/photos`} className="btn btn-quiet btn-sm">{tr.gallery.manageTitle}</Link></p>}
      {loaderData.created && <p className="notice" role="status">{e.created}</p>}
      {msg === "updated" && <p className="notice" role="status">{e.updated}</p>}
      {err && <p className="form-error" role="alert">{err === "badDate" ? e.badDate : tr.errors.fixFields}</p>}

      <div className="two-col">
        <div>
          <h2>{e.programTitle}</h2>
          {program.length === 0 ? <p className="muted">{e.programHint}</p> : (
            <ol className="program">
              {program.map((p) => (
                <li key={p.id}>
                  <span><strong>{p.part}</strong>{p.person && <> — {p.person}</>}</span>
                  {perms.program && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="removePart" />
                      <input type="hidden" name="id" value={p.id} />
                      <button className="link-btn" disabled={busy} aria-label={tr.remove}>✕</button>
                    </Form>
                  )}
                </li>
              ))}
            </ol>
          )}
          {perms.program && (
            <Form method="post" className="inline-form">
              <input type="hidden" name="intent" value="addPart" />
              <input name="part" placeholder={e.part} required maxLength={120} />
              <input name="person" placeholder={e.person} maxLength={120} />
              <button className="btn btn-quiet btn-sm" disabled={busy}>{e.addPart}</button>
            </Form>
          )}

          <h2>{tr.songs.forEvent}</h2>
          {eventSongs.length === 0 ? <p className="muted">{tr.songs.noneForEvent}</p> : (
            <ol className="program">
              {eventSongs.map((sg, i) => (
                <li key={sg.id}>
                  <span><Link to={`/songs/${sg.songId}`}>{sg.title}</Link></span>
                  {perms.songs && (
                    <Form method="post" className="row-actions">
                      <input type="hidden" name="id" value={sg.id} />
                      {i > 0 && <button className="link-btn" name="intent" value="moveUp" disabled={busy} aria-label={tr.songs.moveUp}>↑</button>}
                      {i < eventSongs.length - 1 && <button className="link-btn" name="intent" value="moveDown" disabled={busy} aria-label={tr.songs.moveDown}>↓</button>}
                      <button className="link-btn" name="intent" value="removeSong" disabled={busy} aria-label={tr.remove}>✕</button>
                    </Form>
                  )}
                </li>
              ))}
            </ol>
          )}
          {perms.songs && allSongs.length > 0 && (
            <Form method="post" className="inline-form">
              <input type="hidden" name="intent" value="addSong" />
              <select name="songId" aria-label={tr.songs.addToEvent}>
                {allSongs.map((sg) => <option key={sg.id} value={sg.id}>{sg.title}</option>)}
              </select>
              <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.songs.addToEvent}</button>
            </Form>
          )}

          <h2>{e.tasksTitle}</h2>
          {tasks.length === 0 ? <p className="muted">{tr.tasks.none}</p> : (
            <ul className="tasks">
              {tasks.map((t) => (
                <li key={t.id} className={t.status === "done" ? "is-done" : ""}>
                  <span className="badge">{tr.serviceDept[t.department]}</span>
                  <span className="task-text">{t.task}</span>
                  {t.status === "done" ? (
                    <span className="pill pill--approved">{tr.tasks.done}</span>
                  ) : t.canWork ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="doneTask" />
                      <input type="hidden" name="id" value={t.id} />
                      <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.tasks.markDone}</button>
                    </Form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {perms.assign && (
            <Form method="post" className="inline-form">
              <input type="hidden" name="intent" value="addTask" />
              <select name="department" aria-label={e.assignTo} defaultValue="preparation">
                {SERVICE_DEPARTMENTS.map((d: ServiceDepartment) => <option key={d} value={d}>{tr.serviceDept[d]}</option>)}
              </select>
              <input name="task" placeholder={e.task} required minLength={2} maxLength={300} />
              <button className="btn btn-quiet btn-sm" disabled={busy}>{e.assign}</button>
            </Form>
          )}
        </div>

        {perms.manage && event.status === "scheduled" && (
          <div className="panel">
            <h2>{e.edit}</h2>
            <Form method="post" className="form">
              <input type="hidden" name="intent" value="update" />
              <Field label={e.titleLabel} hint={event.type === "zikr" ? e.titleHint : undefined} name="title" defaultValue={event.title ?? ""} />
              <EthDateFields value={eth} />
              <Field label={e.time} hint={e.timeHint} name="time" defaultValue={event.time ?? ""} />
              <Field label={e.place} name="place" defaultValue={event.place ?? ""} />
              <label className="field"><span>{e.description}</span><textarea name="description" rows={3} defaultValue={event.description ?? ""} /></label>
              <button className="btn btn-primary" disabled={busy}>{tr.save}</button>
            </Form>
            <Form method="post" className="danger-zone">
              <input type="hidden" name="intent" value="cancel" />
              <button className="btn btn-quiet btn-sm" disabled={busy}>{e.cancelEvent}</button>
            </Form>
          </div>
        )}
      </div>
    </section>
  );
}
