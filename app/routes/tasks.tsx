import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { Link } from "react-router";
import type { Route } from "./+types/tasks";
import { PageHead } from "../components/Layout";
import { getDb, schema } from "../db";
import { addDaysIso, isoToEth, todayIso } from "../lib/dates";
import { formatEth } from "../lib/i18n";
import { eventTitle } from "../lib/notify";
import { departmentOf, SERVICE_DEPARTMENTS } from "../lib/permissions";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

/** A department's work across upcoming events. Leader/admin see every department. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "task:view");
  const dept = departmentOf(user.role);
  const depts = dept ? [dept] : [...SERVICE_DEPARTMENTS];
  const rows = await getDb(env.DB)
    .select({
      id: schema.eventTasks.id,
      task: schema.eventTasks.task,
      status: schema.eventTasks.status,
      department: schema.eventTasks.department,
      eventId: schema.events.id,
      type: schema.events.type,
      title: schema.events.title,
      date: schema.events.date,
    })
    .from(schema.eventTasks)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventTasks.eventId))
    .where(and(inArray(schema.eventTasks.department, depts), gte(schema.events.date, addDaysIso(todayIso(), -7))))
    .orderBy(asc(schema.events.date));
  return { rows, dept };
}

export default function Tasks({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const { rows, dept } = loaderData;
  return (
    <section className="page narrow">
      <PageHead back={{ to: "/dashboard", label: tr.nav.dashboard }} title={tr.tasks.title} />
      {dept && <p className="muted">{tr.serviceDept[dept]}</p>}
      {rows.length === 0 ? <p>{tr.tasks.none}</p> : (
        <ul className="tasks">
          {rows.map((t) => (
            <li key={t.id} className={t.status === "done" ? "is-done" : ""}>
              {!dept && <span className="badge">{tr.serviceDept[t.department]}</span>}
              <span className="task-text">
                {t.task}
                <small className="muted"> · <Link to={`/events/${t.eventId}`}>{eventTitle(lang, t)}, {formatEth(lang, isoToEth(t.date))}</Link></small>
              </span>
              <span className={`pill ${t.status === "done" ? "pill--approved" : "pill--pending"}`}>{t.status === "done" ? tr.tasks.done : tr.tasks.open}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
