import { and, asc, count, eq, gt, lt, max } from "drizzle-orm";
import { useState } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/events.$id";
import { EthDateFields } from "../components/EthDateFields";
import { Field } from "../components/Field";
import { getDb, schema } from "../db";
import { isoToEth } from "../lib/dates";
import { eventFormSchema, ethFieldsToIso } from "../lib/event-form";
import { formatEth } from "../lib/i18n";
import { DUTIES, dutyAssignedNotice, eventTitle, MAX_PER_DUTY, planEventRelease, planReschedule, type Duty } from "../lib/notify";
import { drainOutbox, enqueue, loadPlanMembers } from "../lib/notify.server";
import { notify, recipientForUser } from "../lib/notices.server";
import { can, canWorkTask, departmentOf, SERVICE_DEPARTMENTS, type ServiceDepartment } from "../lib/permissions";
import { attendanceDiff, matchesSearch } from "../lib/dashboard";
import { AddPanel, Card, PageHead, TabBar, type Tab } from "../components/Layout";
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
  const duties = await db
    .select({ id: schema.eventDuties.id, duty: schema.eventDuties.duty, memberId: schema.members.id, name: schema.members.fullName })
    .from(schema.eventDuties)
    .innerJoin(schema.members, eq(schema.members.id, schema.eventDuties.memberId))
    .where(eq(schema.eventDuties.eventId, event.id))
    .orderBy(asc(schema.eventDuties.createdAt));
  const pickable = a.manage
    ? await db.select({ id: schema.members.id, fullName: schema.members.fullName }).from(schema.members).where(eq(schema.members.status, "active")).orderBy(asc(schema.members.fullName))
    : [];
  const canAttendance = can(a.user.role, "attendance:mark");
  const attendance = canAttendance
    ? await Promise.all([
        db
          .select({ id: schema.members.id, fullName: schema.members.fullName, studentId: schema.members.studentId, department: schema.members.department })
          .from(schema.members)
          .where(eq(schema.members.status, "active"))
          .orderBy(asc(schema.members.fullName)),
        db.select({ memberId: schema.attendance.memberId }).from(schema.attendance).where(eq(schema.attendance.eventId, event.id)),
      ]).then(([members, present]) => ({ members, present: present.map((p) => p.memberId) }))
    : null;
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
    attendance,
    duties,
    pickable,
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
      context.cloudflare.ctx.waitUntil(drainOutbox(env, db).catch((err) => console.error("reschedule send failed", err)));
    }
    return { message: "updated" as const };
  }

  if (intent === "addDuty" || intent === "removeDuty") {
    if (!a.manage) deny();
    if (intent === "removeDuty") {
      await db.delete(schema.eventDuties).where(and(eq(schema.eventDuties.id, String(form.get("id"))), eq(schema.eventDuties.eventId, event.id)));
      return { ok: true };
    }
    const duty = String(form.get("duty")) as Duty;
    const memberId = String(form.get("memberId") ?? "");
    if (!DUTIES.includes(duty)) return { error: "fixFields" as const };
    const member = await db.query.members.findFirst({ where: and(eq(schema.members.id, memberId), eq(schema.members.status, "active")) });
    if (!member) return { error: "fixFields" as const };
    const [{ n }] = await db.select({ n: count() }).from(schema.eventDuties).where(and(eq(schema.eventDuties.eventId, event.id), eq(schema.eventDuties.duty, duty)));
    if (n >= MAX_PER_DUTY) return { error: "dutyFull" as const };
    const inserted = await db
      .insert(schema.eventDuties)
      .values({ eventId: event.id, duty, memberId, assignedBy: a.user.id })
      .onConflictDoNothing()
      .returning({ id: schema.eventDuties.id });
    if (inserted.length && member.userId) {
      const r = await recipientForUser(db, member.userId);
      notify(env, context.cloudflare.ctx, dutyAssignedNotice(r, event, { memberId, name: member.fullName, duty }, env.PUBLIC_SITE_URL));
    }
    return { ok: true };
  }

  if (intent === "release") {
    if (!a.manage) deny();
    const duties = await db
      .select({ duty: schema.eventDuties.duty, memberId: schema.members.id, name: schema.members.fullName })
      .from(schema.eventDuties)
      .innerJoin(schema.members, eq(schema.members.id, schema.eventDuties.memberId))
      .where(eq(schema.eventDuties.eventId, event.id))
      .orderBy(asc(schema.eventDuties.createdAt));
    const songs = await db
      .select({ title: schema.songs.title })
      .from(schema.eventSongs)
      .innerJoin(schema.songs, eq(schema.songs.id, schema.eventSongs.songId))
      .where(eq(schema.eventSongs.eventId, event.id))
      .orderBy(asc(schema.eventSongs.sort));
    const groupChatId = env.TELEGRAM_GROUP_CHAT_ID || null;
    const items = planEventRelease({
      event,
      duties,
      songs: songs.map((s) => s.title),
      members: await loadPlanMembers(db),
      groupChatId,
      stamp: new Date().toISOString().slice(0, 16),
    });
    await enqueue(db, items);
    context.cloudflare.ctx.waitUntil(drainOutbox(env, db).catch((e) => console.error("release send failed", e)));
    return { message: "released" as const, sent: items.length, noGroup: !groupChatId };
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

  if (intent === "attendance") {
    if (!can(a.user.role, "attendance:mark")) deny();
    const active = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.status, "active"));
    const before = await db.select({ memberId: schema.attendance.memberId }).from(schema.attendance).where(eq(schema.attendance.eventId, event.id));
    const { add, remove } = attendanceDiff(before.map((b) => b.memberId), form.getAll("present").map(String), new Set(active.map((m) => m.id)));
    const stmts = [
      ...add.map((memberId) => db.insert(schema.attendance).values({ eventId: event.id, memberId, markedBy: a.user.id }).onConflictDoNothing()),
      ...remove.map((memberId) => db.delete(schema.attendance).where(and(eq(schema.attendance.eventId, event.id), eq(schema.attendance.memberId, memberId)))),
    ];
    for (let i = 0; i < stmts.length; i += 50) {
      const chunk = stmts.slice(i, i + 50);
      if (chunk.length) await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
    }
    return { message: "attendanceSaved" as const };
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
  const { event, eth, program, tasks, perms, eventSongs, allSongs, attendance, duties, pickable } = loaderData;
  const msg = actionData && "message" in actionData ? actionData.message : null;
  const err = actionData && "error" in actionData ? actionData.error : null;
  const [params] = useSearchParams();

  const tabs: Tab[] = [
    { key: "duties", to: "?tab=duties", label: e.duties, icon: "👥", count: duties.length },
    { key: "program", to: "?tab=program", label: e.programTitle, icon: "📋", count: program.length },
    { key: "tasks", to: "?tab=tasks", label: e.tasksTitle, icon: "✅", count: tasks.filter((t) => t.status === "open").length, alert: true },
    { key: "songs", to: "?tab=songs", label: tr.songs.forEvent, icon: "🎵", count: eventSongs.length },
    ...(attendance ? [{ key: "attendance", to: "?tab=attendance", label: e.attendance, icon: "🙋", count: attendance.present.length }] : []),
    ...(perms.manage && event.status === "scheduled" ? [{ key: "edit", to: "?tab=edit", label: e.edit, icon: "✏️" }] : []),
  ];
  const tab = tabs.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "duties";

  return (
    <section className="page wide">
      <PageHead
        back={{ to: perms.manage ? "/events" : "/tasks", label: perms.manage ? e.title : tr.tasks.title }}
        title={eventTitle(lang, event)}
        sub={
          <>
            <span className={`badge badge--${event.type}`}>{e.types[event.type]}</span>{" "}
            {formatEth(lang, eth)}{event.time ? ` · ${event.time}` : ""}{event.place ? ` · ${event.place}` : ""}
            {event.status === "cancelled" && <> · <strong>{e.cancelled}</strong></>}
          </>
        }
        actions={perms.photos ? <Link to={`/events/${event.id}/photos`}>📷 {tr.gallery.title}</Link> : undefined}
      />
      {loaderData.created && <p className="notice" role="status">{e.created}</p>}
      {msg === "updated" && <p className="notice" role="status">{e.updated}</p>}
      {msg === "attendanceSaved" && <p className="notice" role="status">{tr.saved}</p>}
      {msg === "released" && actionData && "sent" in actionData && (
        <p className="notice" role="status">{e.notifySent(actionData.sent ?? 0)}{actionData.noGroup ? ` ${e.noGroup}` : ""}</p>
      )}
      {err && <p className="form-error" role="alert">{err === "badDate" ? e.badDate : err === "dutyFull" ? e.dutyFull : tr.errors.fixFields}</p>}

      <TabBar tabs={tabs} active={tab} />

      {tab === "duties" && (
        <Card>
          <ul className="duties">
            {DUTIES.map((d) => {
              const list = duties.filter((x) => x.duty === d);
              const taken = new Set(list.map((x) => x.memberId));
              return (
                <li key={d}>
                  <div className="duty-head"><strong>{e.dutyNames[d]}</strong><span className="muted small">{list.length}/{MAX_PER_DUTY}</span></div>
                  <div className="duty-people">
                    {list.length === 0 && <span className="muted small">{e.dutyNone}</span>}
                    {list.map((x) => (
                      <span key={x.id} className="person-chip">
                        {x.name}
                        {perms.manage && event.status === "scheduled" && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="removeDuty" />
                            <input type="hidden" name="id" value={x.id} />
                            <button className="link-btn" disabled={busy} aria-label={tr.remove}>✕</button>
                          </Form>
                        )}
                      </span>
                    ))}
                  </div>
                  {perms.manage && event.status === "scheduled" && list.length < MAX_PER_DUTY && (
                    <Form method="post" className="inline-form duty-add">
                      <input type="hidden" name="intent" value="addDuty" />
                      <input type="hidden" name="duty" value={d} />
                      <select name="memberId" aria-label={e.dutyPick} required defaultValue="">
                        <option value="" disabled>{e.dutyPick}</option>
                        {pickable.filter((m) => !taken.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                      </select>
                      <button className="btn btn-primary btn-sm" disabled={busy}>{e.dutyAdd}</button>
                    </Form>
                  )}
                </li>
              );
            })}
          </ul>
          {perms.manage && <p className="muted small">{e.dutyHint}</p>}
          {perms.manage && event.status === "scheduled" && (
            <div className="release">
              <div>
                <strong>{e.notifyTitle}</strong>
                <p className="muted small">{e.notifyHint}</p>
              </div>
              <Form method="post" onSubmit={(ev) => { if (!confirm(e.notifyTitle + "?")) ev.preventDefault(); }}>
                <input type="hidden" name="intent" value="release" />
                <button className="btn btn-green" disabled={busy}>{e.notifySend}</button>
              </Form>
            </div>
          )}
        </Card>
      )}

      {tab === "program" && (
        <Card>
          {event.type === "zikr" && event.dueYear && event.dueMonth && (
            <p className="muted">{e.dueMonth(formatEth(lang, { year: event.dueYear, month: event.dueMonth }))}</p>
          )}
          {event.description && <p>{event.description}</p>}
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
            <AddPanel label={e.addPart}>
              <Form method="post" className="inline-form">
                <input type="hidden" name="intent" value="addPart" />
                <input name="part" placeholder={e.part} required maxLength={120} />
                <input name="person" placeholder={e.person} maxLength={120} />
                <button className="btn btn-primary btn-sm" disabled={busy}>{tr.save}</button>
              </Form>
            </AddPanel>
          )}
        </Card>
      )}

      {tab === "tasks" && (
        <Card>
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
                      <button className="btn btn-green btn-sm" disabled={busy}>{tr.tasks.markDone}</button>
                    </Form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {perms.assign && (
            <AddPanel label={e.assign}>
              <Form method="post" className="inline-form">
                <input type="hidden" name="intent" value="addTask" />
                <select name="department" aria-label={e.assignTo} defaultValue="preparation">
                  {SERVICE_DEPARTMENTS.map((d: ServiceDepartment) => <option key={d} value={d}>{tr.serviceDept[d]}</option>)}
                </select>
                <input name="task" placeholder={e.task} required minLength={2} maxLength={300} />
                <button className="btn btn-primary btn-sm" disabled={busy}>{e.assign}</button>
              </Form>
            </AddPanel>
          )}
        </Card>
      )}

      {tab === "songs" && (
        <Card>
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
            <AddPanel label={tr.songs.addToEvent}>
              <Form method="post" className="inline-form">
                <input type="hidden" name="intent" value="addSong" />
                <select name="songId" aria-label={tr.songs.addToEvent}>
                  {allSongs.map((sg) => <option key={sg.id} value={sg.id}>{sg.title}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" disabled={busy}>{tr.save}</button>
              </Form>
            </AddPanel>
          )}
        </Card>
      )}

      {tab === "attendance" && attendance && <Attendance members={attendance.members} present={attendance.present} busy={busy} />}

      {tab === "edit" && perms.manage && event.status === "scheduled" && (
        <Card>
          <Form method="post" className="form">
            <input type="hidden" name="intent" value="update" />
            <Field label={e.titleLabel} hint={event.type === "zikr" ? e.titleHint : undefined} name="title" defaultValue={event.title ?? ""} />
            <EthDateFields value={eth} />
            <p className="muted small">{e.rescheduleHint}</p>
            <Field label={e.time} hint={e.timeHint} name="time" defaultValue={event.time ?? ""} />
            <Field label={e.place} name="place" defaultValue={event.place ?? ""} />
            <label className="field"><span>{e.description}</span><textarea name="description" rows={3} defaultValue={event.description ?? ""} /></label>
            <button className="btn btn-primary" disabled={busy}>{tr.save}</button>
          </Form>
          <Form method="post" className="danger-zone" onSubmit={(ev) => { if (!confirm(e.cancelEvent + "?")) ev.preventDefault(); }}>
            <input type="hidden" name="intent" value="cancel" />
            <button className="btn btn-quiet btn-sm" disabled={busy}>{e.cancelEvent}</button>
          </Form>
        </Card>
      )}
    </section>
  );
}

/** Tick who came; a search box and a live count. Saves the whole list at once. */
function Attendance({ members, present, busy }: { members: { id: string; fullName: string; studentId: string | null; department: "cs" | "it" | "ee" }[]; present: string[]; busy: boolean }) {
  const { tr } = useT();
  const e = tr.events;
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState(() => new Set(present));
  const toggle = (id: string) => setTicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="attendance" />
        <div className="attendance-head">
          <strong>{e.presentCount(ticked.size, members.length)}</strong>
          <input type="search" value={q} onChange={(ev) => setQ(ev.currentTarget.value)} placeholder={tr.members.search} aria-label={tr.members.search} />
        </div>
        <ul className="attendance-list">
          {members.map((m) => (
            <li key={m.id} hidden={!matchesSearch(q, [m.fullName, m.studentId])}>
              <label className={ticked.has(m.id) ? "is-present" : ""}>
                <input type="checkbox" name="present" value={m.id} checked={ticked.has(m.id)} onChange={() => toggle(m.id)} />
                <span>{m.fullName}</span>
                <small className="muted">{m.studentId ?? ""} · {tr.dept[m.department]}</small>
              </label>
            </li>
          ))}
        </ul>
        <button className="btn btn-green" disabled={busy}>{tr.save}</button>
      </Form>
    </Card>
  );
}
