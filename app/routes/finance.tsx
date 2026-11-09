import { and, asc, eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/finance";
import { getDb, schema } from "../db";
import { expectedAmount, reviewContributionTransition } from "../lib/contributions";
import { formatEth, standingLabel } from "../lib/i18n";
import { classInfo } from "../lib/classyear";
import { toEth } from "../lib/ethiopian";
import { requirePermission } from "../lib/session.server";
import { can } from "../lib/permissions";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "finance:view");
  const queue = await getDb(env.DB)
    .select({
      id: schema.contributions.id,
      amount: schema.contributions.amount,
      monthlyRate: schema.contributions.monthlyRate,
      months: schema.contributions.months,
      reason: schema.contributions.reason,
      createdAt: schema.contributions.createdAt,
      fullName: schema.members.fullName,
      department: schema.members.department,
      graduationYear: schema.members.graduationYear,
      graduationMonth: schema.members.graduationMonth,
      studyYear: schema.members.studyYear,
      registeredYear: schema.members.registeredYear,
      telegramUsername: schema.user.telegramUsername,
    })
    .from(schema.contributions)
    .innerJoin(schema.members, eq(schema.members.id, schema.contributions.memberId))
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(eq(schema.contributions.status, "pending"))
    .orderBy(asc(schema.contributions.createdAt));
  const today = toEth(new Date());
  return { queue: queue.map((c) => ({ ...c, standing: classInfo(c, today) })), canReview: can(user.role, "contribution:review"), canSettings: can(user.role, "dues:set"), canReceipts: can(user.role, "receipt:view_any") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const reviewer = await requirePermission(request, env, "contribution:review");
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "reject") throw new Response("Bad request", { status: 400 });
  const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;

  const db = getDb(env.DB);
  const c = await db.query.contributions.findFirst({ where: eq(schema.contributions.id, id), columns: { status: true } });
  if (!c) throw new Response("Not found", { status: 404 });
  const next = reviewContributionTransition(c.status, decision);
  if (!next) return { message: "already" as const };

  const update = db
    .update(schema.contributions)
    .set({ status: next, reviewNote: note, reviewedBy: reviewer.id, reviewedAt: new Date() })
    .where(and(eq(schema.contributions.id, id), eq(schema.contributions.status, "pending")));
  if (next === "rejected") {
    // Free the months so the member can resubmit; the contribution row keeps the history.
    await db.batch([update, db.delete(schema.contributionMonths).where(eq(schema.contributionMonths.contributionId, id))]);
  } else {
    await update;
  }
  return { message: next };
}

export default function Finance({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const f = tr.finance;
  const nav = useNavigation();
  return (
    <section className="page wide">
      <h1>{f.title}</h1>
      <p className="me-links"><Link to="/finance/ledger">{tr.ledger.title} →</Link><Link to="/finance/month">{f.monthTitle} →</Link>{loaderData.canSettings && <Link to="/finance/settings">{f.settingsTitle} →</Link>}</p>
      {actionData?.message && <p className="notice" role="status">{f[actionData.message]}</p>}
      {!loaderData.canReview && <p className="muted">{f.reviewOnlyFinance}</p>}

      <h2>{f.queueTitle}</h2>
      {loaderData.queue.length === 0 ? (
        <p>{f.queueEmpty}</p>
      ) : (
        <ul className="review-list">
          {loaderData.queue.map((c) => {
            const expected = expectedAmount(c.monthlyRate, c.months.length);
            return (
              <li key={c.id} className="review-card">
                {loaderData.canReceipts ? (
                  <a href={`/receipts/${c.id}`} target="_blank" rel="noreferrer" className="review-receipt">
                    <img src={`/receipts/${c.id}`} alt={f.receipt} loading="lazy" />
                  </a>
                ) : (
                  <div className="review-receipt muted">🔒</div>
                )}
                <div className="review-body">
                  <p>
                    <strong>{c.fullName}</strong> · {tr.dept[c.department]} · {standingLabel(lang, c.standing)}
                    {c.telegramUsername && <> · <a href={`https://t.me/${c.telegramUsername}`} target="_blank" rel="noreferrer">@{c.telegramUsername}</a></>}
                  </p>
                  <p>{f.months}: {c.months.map(([y, m]) => formatEth(lang, { year: y, month: m })).join(", ")}</p>
                  <p>
                    {f.amount}: <strong>{c.amount} {tr.birr}</strong>
                    {c.amount !== expected && <span className="warn"> · {f.mismatch(expected)}</span>}
                  </p>
                  {c.reason && <p className="row-note">{c.reason}</p>}
                  {loaderData.canReview && (
                  <Form method="post" className="review-actions">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="note" placeholder={f.note} maxLength={300} />
                    <button name="decision" value="approve" className="btn btn-primary btn-sm" disabled={nav.state !== "idle"}>{f.approve}</button>
                    <button name="decision" value="reject" className="btn btn-quiet btn-sm" disabled={nav.state !== "idle"}>{f.reject}</button>
                  </Form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
