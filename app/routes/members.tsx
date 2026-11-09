import { and, asc, eq } from "drizzle-orm";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/members";
import { getDb, schema } from "../db";
import { classInfo } from "../lib/classyear";
import { toEth } from "../lib/ethiopian";
import { standingLabel } from "../lib/i18n";
import { clearPassword } from "../lib/accounts.server";
import { can, canAssignRole, canResetPassword, isRole, ROLES, type Role } from "../lib/permissions";
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
  const m = await db.query.members.findFirst({ where: eq(schema.members.id, id), columns: { status: true } });
  if (!m) throw new Response("Not found", { status: 404 });
  const next = reviewMemberTransition(m.status, decision);
  if (!next) return { message: "already" as const };
  await db
    .update(schema.members)
    .set({ status: next, reviewedBy: reviewer.id, reviewedAt: new Date() })
    .where(and(eq(schema.members.id, id), eq(schema.members.status, "pending")));
  return { message: next === "active" ? ("approved" as const) : ("rejected" as const) };
}

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const t = tr.members;
  const nav = useNavigation();
  const { pending, active, canReview, canRoles, actorRole } = loaderData;
  type Row = (typeof active)[number];

  const cells = (m: Row) => (
    <>
      <td>{m.fullName}{m.christianName && <small className="muted"> ({m.christianName})</small>}{m.studentId && <><br /><small className="muted">{m.studentId}</small></>}</td>
      <td>{tr.dept[m.department]}</td>
      <td>{standingLabel(lang, m.standing)}</td>
      <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
      <td>{m.telegramUsername ? <a href={`https://t.me/${m.telegramUsername}`} target="_blank" rel="noreferrer">@{m.telegramUsername}</a> : "—"}</td>
    </>
  );
  const head = (extra: string | null) => (
    <thead>
      <tr><th>{t.name}</th><th>{t.department}</th><th>{t.standing}</th><th>{t.phone}</th><th>{t.telegram}</th>{extra !== null && <th>{extra}</th>}</tr>
    </thead>
  );

  return (
    <section className="page wide">
      <h1>{t.title}</h1>
      {actionData?.message && <p className={actionData.message === "roleDenied" ? "form-error" : "notice"} role="status">{t[actionData.message]}</p>}

      {canReview && (
        <>
          <h2>{t.pendingTitle}</h2>
          {pending.length === 0 ? <p>{t.pendingEmpty}</p> : (
            <div className="table-wrap"><table>{head("")}<tbody>
              {pending.map((m) => (
                <tr key={m.id}>
                  {cells(m)}
                  <td>
                    <Form method="post" className="row-actions">
                      <input type="hidden" name="id" value={m.id} />
                      <button name="decision" value="approve" className="btn btn-primary btn-sm" disabled={nav.state !== "idle"}>{t.approve}</button>
                      <button name="decision" value="reject" className="btn btn-quiet btn-sm" disabled={nav.state !== "idle"}>{t.reject}</button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </>
      )}

      <h2>{t.activeTitle} ({active.length})</h2>
      <div className="table-wrap"><table>{head(t.role)}<tbody>
        {active.map((m) => {
          const editable = canRoles && ROLES.some((r) => r !== m.role && canAssignRole(actorRole, m.role, r));
          return (
            <tr key={m.id}>
              {cells(m)}
              <td>
                {editable ? (
                  <Form method="post" className="row-actions">
                    <input type="hidden" name="intent" value="role" />
                    <input type="hidden" name="userId" value={m.userId} />
                    <select name="role" defaultValue={m.role} aria-label={t.role}>
                      {ROLES.filter((r) => r === m.role || canAssignRole(actorRole, m.role, r)).map((r) => (
                        <option key={r} value={r}>{tr.roles[r]}</option>
                      ))}
                    </select>
                    <button className="btn btn-quiet btn-sm" disabled={nav.state !== "idle"}>{tr.save}</button>
                  </Form>
                ) : (
                  tr.roles[m.role]
                )}
                {canReview && canResetPassword(actorRole, m.role) && (
                  <Form method="post" className="row-actions" onSubmit={(e) => { if (!confirm(t.resetConfirm)) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="resetPassword" />
                    <input type="hidden" name="userId" value={m.userId} />
                    <button className="link-btn" disabled={nav.state !== "idle"}>{t.resetPassword}</button>
                  </Form>
                )}
              </td>
            </tr>
          );
        })}
      </tbody></table></div>
    </section>
  );
}
