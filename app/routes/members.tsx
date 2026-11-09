import { and, asc, eq } from "drizzle-orm";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { Chips } from "../components/Chips";
import { PageHead } from "../components/Layout";
import { ACADEMIC_DEPARTMENTS } from "../config";
import { countBy, matchesSearch, pickParam } from "../lib/dashboard";
import type { Route } from "./+types/members";
import { getDb, schema } from "../db";
import { classInfo } from "../lib/classyear";
import { toEth } from "../lib/ethiopian";
import { standingLabel } from "../lib/i18n";
import { clearPassword } from "../lib/accounts.server";
import { approvedNotice, roleNotice } from "../lib/notices";
import { notify, recipientForUser } from "../lib/notices.server";
import { can, canAssignRole, canResetPassword, isRole, ROLES, SERVICE_DEPARTMENTS, type Role, type ServiceDepartment } from "../lib/permissions";
import { reviewMemberTransition } from "../lib/registration";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "member:list");
  const rows = await getDb(env.DB)
    .select({
      id: schema.members.id,
      userId: schema.members.userId,
      fullName: schema.members.fullName,
      christianName: schema.members.christianName,
      department: schema.members.department,
      graduationYear: schema.members.graduationYear,
      graduationMonth: schema.members.graduationMonth,
      studyYear: schema.members.studyYear,
      registeredYear: schema.members.registeredYear,
      phone: schema.members.phone,
      studentId: schema.members.studentId,
      interests: schema.members.interests,
      status: schema.members.status,
      telegramUsername: schema.user.telegramUsername,
      role: schema.user.role,
    })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .orderBy(asc(schema.members.fullName));
  const today = toEth(new Date());
  const all = rows.map((m) => ({ ...m, role: (isRole(m.role) ? m.role : "member") as Role, standing: classInfo(m, today) }));
  return {
    actorRole: user.role,
    canReview: can(user.role, "registration:review"),
    canRoles: can(user.role, "role:assign"),
    canContacts: can(user.role, "contact:manage"),
    pending: all.filter((m) => m.status === "pending"),
    active: all.filter((m) => m.status === "active"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const form = await request.formData();
  const db = getDb(env.DB);

  if (form.get("intent") === "role") {
    const actor = await requirePermission(request, env, "role:assign");
    const userId = String(form.get("userId") ?? "");
    const next = form.get("role");
    if (!isRole(next)) throw new Response("Bad request", { status: 400 });
    const target = await db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { role: true } });
    if (!target) throw new Response("Not found", { status: 404 });
    const current = isRole(target.role) ? target.role : "member";
    if (userId === actor.id || !canAssignRole(actor.role, current, next)) return { message: "roleDenied" as const };
    await db.update(schema.user).set({ role: next }).where(eq(schema.user.id, userId));
    notify(env, context.cloudflare.ctx, roleNotice(await recipientForUser(db, userId), next, env.PUBLIC_SITE_URL, Date.now()));
    return { message: "roleSaved" as const };
  }

  if (form.get("intent") === "resetPassword") {
    const actor = await requirePermission(request, env, "registration:review");
    const userId = String(form.get("userId") ?? "");
    const target = await db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { role: true } });
    if (!target) throw new Response("Not found", { status: 404 });
    if (userId === actor.id || !canResetPassword(actor.role, isRole(target.role) ? target.role : "member")) return { message: "roleDenied" as const };
    await clearPassword(db, userId);
    return { message: "passwordReset" as const };
  }

  const reviewer = await requirePermission(request, env, "registration:review");
  const id = String(form.get("id") ?? "");
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "reject") throw new Response("Bad request", { status: 400 });
  const m = await db.query.members.findFirst({ where: eq(schema.members.id, id), columns: { status: true, userId: true, fullName: true } });
  if (!m) throw new Response("Not found", { status: 404 });
  const next = reviewMemberTransition(m.status, decision);
  if (!next) return { message: "already" as const };
  await db
    .update(schema.members)
    .set({ status: next, reviewedBy: reviewer.id, reviewedAt: new Date() })
    .where(and(eq(schema.members.id, id), eq(schema.members.status, "pending")));
  if (next === "active") notify(env, context.cloudflare.ctx, approvedNotice(await recipientForUser(db, m.userId), id, m.fullName, env.PUBLIC_SITE_URL));
  return { message: next === "active" ? ("approved" as const) : ("rejected" as const) };
}

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const t = tr.members;
  const d = tr.dashboard;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { canReview, canRoles, actorRole } = loaderData;
  const [params] = useSearchParams();

  // Filters (combine): status, academic department, student/graduate, wants to serve in, search
  const status = (canReview && pickParam(params.get("status"), ["pending", "active"] as const)) || "active";
  const base = status === "pending" ? loaderData.pending : loaderData.active;
  const dept = pickParam(params.get("dept"), ACADEMIC_DEPARTMENTS);
  const standing = pickParam(params.get("standing"), ["student", "graduate"] as const);
  const want = pickParam(params.get("want"), SERVICE_DEPARTMENTS);
  const q = params.get("q") ?? "";
  const searched = base.filter((m) => matchesSearch(q, [m.fullName, m.christianName, m.studentId, m.phone, m.telegramUsername]));
  // Each row of buttons counts what the other filters leave, so the numbers always add up
  const byDept = searched.filter((m) => (!standing || m.standing.kind === standing) && (!want || m.interests.includes(want)));
  const byStanding = searched.filter((m) => (!dept || m.department === dept) && (!want || m.interests.includes(want)));
  const byWant = searched.filter((m) => (!dept || m.department === dept) && (!standing || m.standing.kind === standing));
  const rows = byDept.filter((m) => !dept || m.department === dept);

  return (
    <section className="page wide">
      <PageHead back={{ to: "/dashboard", label: tr.nav.dashboard }} title={t.title} sub={tr.serviceDept.members} />
      {loaderData.canContacts && <p><Link to="/contacts">{tr.contacts.manageTitle} →</Link></p>}
      {actionData?.message && <p className={actionData.message === "roleDenied" ? "form-error" : "notice"} role="status">{t[actionData.message]}</p>}

      <div className="card filter-card">
      <div className="chips" role="group" aria-label={t.status}>
        <Link to="?status=active" className="chip" aria-current={status === "active"}>{t.activeTitle} <b>{loaderData.active.length}</b></Link>
        {canReview && (
          <Link to="?status=pending" className={`chip${loaderData.pending.length ? " chip--alert" : ""}`} aria-current={status === "pending"}>
            {t.pendingTitle} <b>{loaderData.pending.length}</b>
          </Link>
        )}
      </div>

      <Form method="get" className="list-tools" role="search">
        {[...params.entries()].filter(([k]) => k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="search" name="q" defaultValue={q} placeholder={t.search} aria-label={t.search} />
        <button className="btn btn-quiet btn-sm">{tr.materials.filter}</button>
      </Form>
      <Chips label={t.department} param="dept" value={dept} allLabel={tr.materials.allDepartments}
        options={ACADEMIC_DEPARTMENTS.map((x) => [x, tr.dept[x]])} counts={countBy(byDept, ACADEMIC_DEPARTMENTS, (m) => m.department)} />
      <Chips label={t.standing} param="standing" value={standing} allLabel={t.all}
        options={[["student", d.students], ["graduate", d.graduates]]} counts={countBy(byStanding, ["student", "graduate"] as const, (m) => m.standing.kind)} />
      <Chips label={tr.register.interests} param="want" value={want} allLabel={t.all}
        options={SERVICE_DEPARTMENTS.map((x) => [x, tr.serviceDept[x]])} counts={{ ...countBy(byWant.flatMap((m) => m.interests.map((i) => ({ i }))), SERVICE_DEPARTMENTS, (r) => r.i), all: byWant.length }} />
      </div>

      <h2 className="list-title">{status === "pending" ? t.pendingTitle : t.activeTitle} <span className="muted">({rows.length})</span></h2>
      {rows.length === 0 ? <p className="muted">{status === "pending" ? t.pendingEmpty : t.none}</p> : (
        <div className="table-wrap">
          <table className="table-oneline">
            <thead>
              <tr><th>{t.name}</th><th>ID</th><th>{t.department}</th><th>{t.standing}</th><th>{t.phone}</th><th>{t.telegram}</th><th>{status === "pending" ? "" : t.role}</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const editable = canRoles && ROLES.some((r) => r !== m.role && canAssignRole(actorRole, m.role, r));
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.fullName}</strong>{m.christianName && <span className="muted"> ({m.christianName})</span>}
                      {m.interests.length > 0 && (
                        <span className="interests">{m.interests.map((x) => <span key={x} className="badge">{tr.serviceDept[x as ServiceDepartment] ?? x}</span>)}</span>
                      )}
                    </td>
                    <td>{m.studentId ?? "—"}</td>
                    <td>{tr.dept[m.department]}</td>
                    <td>{standingLabel(lang, m.standing)}</td>
                    <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
                    <td>{m.telegramUsername ? <a href={`https://t.me/${m.telegramUsername}`} target="_blank" rel="noreferrer">@{m.telegramUsername}</a> : "—"}</td>
                    <td>
                      {status === "pending" ? (
                        canReview && (
                          <Form method="post" className="row-actions">
                            <input type="hidden" name="id" value={m.id} />
                            <button name="decision" value="approve" className="btn btn-primary btn-sm" disabled={busy}>{t.approve}</button>
                            <button name="decision" value="reject" className="btn btn-quiet btn-sm" disabled={busy}>{t.reject}</button>
                          </Form>
                        )
                      ) : (
                        <span className="row-actions">
                          {editable ? (
                            <Form method="post" className="row-actions">
                              <input type="hidden" name="intent" value="role" />
                              <input type="hidden" name="userId" value={m.userId} />
                              <select name="role" defaultValue={m.role} aria-label={t.role}>
                                {ROLES.filter((r) => r === m.role || canAssignRole(actorRole, m.role, r)).map((r) => (
                                  <option key={r} value={r}>{tr.roles[r]}</option>
                                ))}
                              </select>
                              <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.save}</button>
                            </Form>
                          ) : (
                            tr.roles[m.role]
                          )}
                          {canReview && canResetPassword(actorRole, m.role) && (
                            <Form method="post" className="row-actions" onSubmit={(e) => { if (!confirm(t.resetConfirm)) e.preventDefault(); }}>
                              <input type="hidden" name="intent" value="resetPassword" />
                              <input type="hidden" name="userId" value={m.userId} />
                              <button className="link-btn" disabled={busy} title={t.resetPassword}>🔑</button>
                            </Form>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
