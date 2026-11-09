import { and, asc, count, eq, gte, isNull, lt } from "drizzle-orm";
import { Fragment } from "react";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/dashboard";
import { getDb, schema } from "../db";
import { ACADEMIC_DEPARTMENTS } from "../config";
import { classInfo } from "../lib/classyear";
import { paymentBreakdown, type Cell } from "../lib/dashboard";
import { isoToEth, todayIso } from "../lib/dates";
import { currentDueMonth, toEth } from "../lib/ethiopian";
import { monthPayRows } from "../lib/finance.server";
import { formatEth } from "../lib/i18n";
import { monthlyTotals } from "../lib/ledger";
import { loadMoneyItems } from "../lib/ledger.server";
import { eventTitle } from "../lib/notify";
import { can, departmentOf, hasDashboard, SERVICE_DEPARTMENTS } from "../lib/permissions";
import { requireUser } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  if (!hasDashboard(user.role)) throw redirect("/me");
  const db = getDb(env.DB);
  const today = toEth(new Date());
  const iso = todayIso();
  const month = currentDueMonth(today);
  const role = user.role;

  const members = can(role, "member:list")
    ? await (async () => {
        const rows = await db
          .select({
            status: schema.members.status,
            department: schema.members.department,
            graduationYear: schema.members.graduationYear,
            graduationMonth: schema.members.graduationMonth,
            studyYear: schema.members.studyYear,
            registeredYear: schema.members.registeredYear,
            interests: schema.members.interests,
            registeredAt: schema.members.createdAt,
          })
          .from(schema.members);
        const active = rows.filter((r) => r.status === "active");
        const kinds = active.map((r) => ({ ...r, kind: classInfo(r, today).kind }));
        const monthStart = Date.now() - 30 * 86_400_000;
        return {
          pending: rows.filter((r) => r.status === "pending").length,
          active: active.length,
          students: kinds.filter((r) => r.kind === "student").length,
          graduates: kinds.filter((r) => r.kind === "graduate").length,
          newLast30: rows.filter((r) => r.registeredAt.getTime() >= monthStart).length,
          byDept: ACADEMIC_DEPARTMENTS.map((d) => ({
            dept: d,
            students: kinds.filter((r) => r.department === d && r.kind === "student").length,
            graduates: kinds.filter((r) => r.department === d && r.kind === "graduate").length,
          })),
          interests: SERVICE_DEPARTMENTS.map((d) => ({ dept: d, count: active.filter((r) => r.interests.includes(d)).length })),
        };
      })()
    : null;

  const finance = can(role, "finance:view")
    ? await (async () => {
        const [{ rows, collected }, [{ n: toReview }], items] = await Promise.all([
          monthPayRows(db, month, today),
          db.select({ n: count() }).from(schema.contributions).where(eq(schema.contributions.status, "pending")),
          loadMoneyItems(db),
        ]);
        const totals = monthlyTotals(items, { year: today.year, month: today.month });
        return { month, collected, toReview, balance: totals.at(-1)?.closing ?? 0, ...paymentBreakdown(rows) };
      })()
    : null;

  const events = can(role, "event:manage") || can(role, "task:view")
    ? await (async () => {
        const upcoming = await db
          .select({ id: schema.events.id, type: schema.events.type, title: schema.events.title, date: schema.events.date })
          .from(schema.events)
          .where(and(gte(schema.events.date, iso), eq(schema.events.status, "scheduled")))
          .orderBy(asc(schema.events.date))
          .limit(3);
        const myDept = departmentOf(role);
        const tasks = await db
          .select({ department: schema.eventTasks.department })
          .from(schema.eventTasks)
          .innerJoin(schema.events, eq(schema.events.id, schema.eventTasks.eventId))
          .where(and(eq(schema.eventTasks.status, "open"), gte(schema.events.date, iso)));
        return {
          upcoming: upcoming.map((e) => ({ ...e, eth: isoToEth(e.date) })),
          openTasks: tasks.length,
          myTasks: myDept ? tasks.filter((t) => t.department === myDept).length : null,
        };
      })()
    : null;

  const songs = can(role, "song:manage")
    ? await (async () => {
        const rows = await db.select({ audio: schema.songs.audioKey }).from(schema.songs);
        return { total: rows.length, noAudio: rows.filter((r) => !r.audio).length };
      })()
    : null;

  const property = can(role, "property:manage")
    ? await (async () => {
        const [items, loans] = await Promise.all([
          db.select({ quantity: schema.propertyItems.quantity, condition: schema.propertyItems.condition }).from(schema.propertyItems),
          db.select({ quantity: schema.propertyLoans.quantity, due: schema.propertyLoans.dueDate }).from(schema.propertyLoans).where(isNull(schema.propertyLoans.returnedAt)),
        ]);
        return {
          items: items.reduce((n, i) => n + i.quantity, 0),
          broken: items.filter((i) => i.condition === "broken").reduce((n, i) => n + i.quantity, 0),
          lent: loans.reduce((n, l) => n + l.quantity, 0),
          overdue: loans.filter((l) => l.due && l.due < iso).length,
        };
      })()
    : null;

  const education = can(role, "education:manage")
    ? await (async () => {
        const rows = await db.select({ status: schema.materials.status }).from(schema.materials);
        return { pending: rows.filter((r) => r.status === "pending").length, approved: rows.filter((r) => r.status === "approved").length };
      })()
    : null;

  const feedback = can(role, "feedback:read")
    ? (await db.select({ n: count() }).from(schema.feedback).where(eq(schema.feedback.status, "new")))[0].n
    : null;

  return { name: user.name, role, today, members, finance, events, songs, property, education, feedback };
}

function Tile({ to, n, label, tone = "lapis" }: { to: string; n: number | string; label: string; tone?: "lapis" | "gold" | "green" | "red" | "slate" }) {
  return (
    <Link to={to} className={`tile tile--${tone}`}>
      <strong>{n}</strong>
      <span>{label}</span>
    </Link>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const d = tr.dashboard;
  const { name, role, today, members, finance, events, songs, property, education, feedback } = loaderData;
  const birr = (n: number) => `${n.toLocaleString("en-US")} ${tr.birr}`;
  const cell = (c: Cell) => (
    <>
      <td className="num">{c.members}</td>
      <td className="num money-in">{c.paid}</td>
      <td className="num">{c.pending}</td>
      <td className="num money-out">{c.unpaid}</td>
    </>
  );

  return (
    <div className="dash">
      <header className="dash-hero">
        <div className="dash-hero-inner">
          <p className="dash-date">{formatEth(lang, today)}</p>
          <h1>{d.hello(name)}</h1>
          <p className="dash-role">{tr.roles[role]}</p>
        </div>
      </header>

      <div className="dash-body">
        {feedback !== null && feedback > 0 && (
          <Link to="/feedback/inbox" className="dash-alert">💬 {d.newFeedback(feedback)}</Link>
        )}

        {members && (
          <section className="dash-card" aria-labelledby="d-members">
            <h2 id="d-members">{tr.serviceDept.members}</h2>
            <div className="tiles">
              <Tile to="/members?status=pending" n={members.pending} label={d.pendingRegistrations} tone={members.pending ? "gold" : "slate"} />
              <Tile to="/members" n={members.active} label={d.activeMembers} />
              <Tile to="/members?standing=student" n={members.students} label={d.students} tone="green" />
              <Tile to="/members?standing=graduate" n={members.graduates} label={d.graduates} tone="slate" />
              <Tile to="/members?status=pending" n={members.newLast30} label={d.newLast30} tone="slate" />
            </div>
            <div className="dash-two">
              <div className="table-wrap">
                <table className="dash-table">
                  <thead><tr><th>{tr.members.department}</th><th className="num">{d.students}</th><th className="num">{d.graduates}</th></tr></thead>
                  <tbody>
                    {members.byDept.map((r) => (
                      <tr key={r.dept}>
                        <td><Link to={`/members?dept=${r.dept}`}>{tr.dept[r.dept]}</Link></td>
                        <td className="num"><Link to={`/members?dept=${r.dept}&standing=student`}>{r.students}</Link></td>
                        <td className="num"><Link to={`/members?dept=${r.dept}&standing=graduate`}>{r.graduates}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="dash-table">
                  <thead><tr><th>{tr.register.interests}</th><th className="num">#</th></tr></thead>
                  <tbody>
                    {members.interests.map((r) => (
                      <tr key={r.dept}><td><Link to={`/members?want=${r.dept}`}>{tr.serviceDept[r.dept]}</Link></td><td className="num">{r.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {finance && (
          <section className="dash-card" aria-labelledby="d-finance">
            <h2 id="d-finance">{tr.serviceDept.finance} · {formatEth(lang, finance.month)}</h2>
            <div className="tiles">
              <Tile to="/finance" n={finance.toReview} label={d.toReview} tone={finance.toReview ? "gold" : "slate"} />
              <Tile to="/finance/month?status=approved" n={finance.total.paid} label={d.paid} tone="green" />
              <Tile to="/finance/month?status=pending" n={finance.total.pending} label={d.pending} tone="slate" />
              <Tile to="/finance/month?status=unpaid" n={finance.total.unpaid} label={d.unpaid} tone={finance.total.unpaid ? "red" : "slate"} />
              <Tile to="/finance/month" n={birr(finance.collected)} label={d.collected} tone="green" />
              <Tile to="/finance/ledger" n={birr(finance.balance)} label={d.balance} />
            </div>
            <div className="table-wrap">
              <table className="dash-table">
                <thead>
                  <tr><th rowSpan={2}>{tr.members.department}</th><th colSpan={4}>{d.students}</th><th colSpan={4}>{d.graduates}</th></tr>
                  <tr>
                    {[0, 1].map((i) => (
                      <Fragment key={i}>
                        <th className="num">{d.members}</th><th className="num">{d.paid}</th><th className="num">{d.pending}</th><th className="num">{d.unpaid}</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ACADEMIC_DEPARTMENTS.map((dep) => (
                    <tr key={dep}>
                      <td><Link to={`/finance/month?dept=${dep}`}>{tr.dept[dep]}</Link></td>
                      {cell(finance.table[dep].student)}
                      {cell(finance.table[dep].graduate)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {events && (
          <section className="dash-card" aria-labelledby="d-events">
            <h2 id="d-events">{tr.nav.events}</h2>
            <div className="tiles">
              {events.myTasks !== null && <Tile to="/tasks" n={events.myTasks} label={d.myTasks} tone={events.myTasks ? "gold" : "slate"} />}
              {can(role, "event:manage") && <Tile to="/events" n={events.openTasks} label={d.openTasks} tone="slate" />}
            </div>
            {events.upcoming.length > 0 && (
              <ul className="dash-list">
                {events.upcoming.map((e) => (
                  <li key={e.id}>
                    <Link to={`/events/${e.id}`}>{eventTitle(lang, e)}</Link>
                    <span className="muted">{formatEth(lang, e.eth)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {songs && (
          <section className="dash-card" aria-labelledby="d-songs">
            <h2 id="d-songs">{tr.serviceDept.songs}</h2>
            <div className="tiles">
              <Tile to="/songs" n={songs.total} label={d.songs} />
              <Tile to="/songs" n={songs.noAudio} label={d.noAudio} tone={songs.noAudio ? "gold" : "slate"} />
            </div>
          </section>
        )}

        {property && (
          <section className="dash-card" aria-labelledby="d-property">
            <h2 id="d-property">{tr.serviceDept.property}</h2>
            <div className="tiles">
              <Tile to="/property" n={property.items} label={d.items} />
              <Tile to="/property" n={property.lent} label={d.lent} tone="slate" />
              <Tile to="/property" n={property.overdue} label={d.overdue} tone={property.overdue ? "red" : "slate"} />
              <Tile to="/property" n={property.broken} label={d.broken} tone={property.broken ? "gold" : "slate"} />
            </div>
          </section>
        )}

        {education && (
          <section className="dash-card" aria-labelledby="d-education">
            <h2 id="d-education">{tr.serviceDept.education}</h2>
            <div className="tiles">
              <Tile to="/materials" n={education.pending} label={d.toReview} tone={education.pending ? "gold" : "slate"} />
              <Tile to="/materials" n={education.approved} label={d.materials} />
            </div>
          </section>
        )}

        <p className="dash-me"><Link to="/me">{tr.nav.myPage} →</Link></p>
      </div>
    </div>
  );
}
