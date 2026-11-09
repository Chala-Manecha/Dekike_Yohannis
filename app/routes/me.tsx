import { and, desc, eq, inArray } from "drizzle-orm";
import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/me";
import { ReceiptInput } from "../components/ReceiptInput";
import { getDb, schema } from "../db";
import { checkMonths, checkReceipt, contributionSchema, expectedAmount, payableMonths } from "../lib/contributions";
import { classInfo, duesFor } from "../lib/classyear";
import { getDues } from "../lib/settings.server";
import { departmentOf } from "../lib/permissions";
import { currentDueMonth, monthKey, toEth, type EthMonth } from "../lib/ethiopian";
import { formatEth, standingLabel } from "../lib/i18n";
import { requireUser } from "../lib/session.server";
import { markSignedOut } from "../components/TelegramMiniApp";
import { paymentSubmittedNotices } from "../lib/notices";
import { notify, recipientsWithRoles } from "../lib/notices.server";
import { useT } from "../lib/use-t";
import { useState } from "react";

type MonthStatus = "approved" | "pending" | "unpaid";

async function loadMember(db: ReturnType<typeof getDb>, userId: string) {
  return db.query.members.findFirst({ where: eq(schema.members.userId, userId) });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await loadMember(db, user.id);
  const url = new URL(request.url);
  const flags = { registered: url.searchParams.has("registered"), sent: url.searchParams.has("sent") };
  if (!member) return { user, member: null, flags } as const;

  const today = toEth(new Date());
  const standing = classInfo(member, today);
  const rate = duesFor(standing, await getDues(db));
  const window = payableMonths(currentDueMonth(today));

  const claimed = await db
    .select({ y: schema.contributionMonths.ethYear, m: schema.contributionMonths.ethMonth, status: schema.contributions.status })
    .from(schema.contributionMonths)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionMonths.contributionId))
    .where(eq(schema.contributionMonths.memberId, member.id));
  const statusByMonth = new Map(claimed.map((c) => [c.y * 100 + c.m, c.status as MonthStatus]));

  const months = window.map((m) => ({ ...m, status: statusByMonth.get(monthKey(m)) ?? ("unpaid" as MonthStatus) }));

  const history = await db
    .select({
      id: schema.contributions.id,
      amount: schema.contributions.amount,
      months: schema.contributions.months,
      status: schema.contributions.status,
      reviewNote: schema.contributions.reviewNote,
      createdAt: schema.contributions.createdAt,
    })
    .from(schema.contributions)
    .where(eq(schema.contributions.memberId, member.id))
    .orderBy(desc(schema.contributions.createdAt))
    .limit(24);

  return {
    user,
    member: { status: member.status, fullName: member.fullName },
    standing,
    rate,
    hasDepartment: departmentOf(user.role) !== null || user.role === "leader" || user.role === "admin",
    months,
    history,
    flags,
  } as const;
}

type ErrorKey = "fixFields" | "months" | "amount" | "receiptMissing" | "receiptType" | "receiptSize" | "monthTaken";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await loadMember(db, user.id);
  if (!member || member.status !== "active") throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const parsed = contributionSchema.safeParse({
    months: form.getAll("months"),
    amount: form.get("amount"),
    reason: form.get("reason") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<string, ErrorKey>> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message as ErrorKey;
    return { error: "fixFields" as ErrorKey, fieldErrors };
  }

  const today = toEth(new Date());
  const standing = classInfo(member, today);
  const rate = duesFor(standing, await getDues(db));
  const months = checkMonths(parsed.data.months, payableMonths(currentDueMonth(today)));
  if (!months) return { error: "months" as ErrorKey, fieldErrors: { months: "months" as ErrorKey } };

  const receipt = checkReceipt(form.get("receipt"));
  if (!receipt.ok) return { error: receipt.error as ErrorKey, fieldErrors: { receipt: receipt.error as ErrorKey } };

  // Cheap check before uploading; the unique index below is the real guard.
  const taken = await db
    .select({ y: schema.contributionMonths.ethYear, m: schema.contributionMonths.ethMonth })
    .from(schema.contributionMonths)
    .where(and(eq(schema.contributionMonths.memberId, member.id), inArray(schema.contributionMonths.ethYear, [...new Set(months.map((m) => m.year))])));
  const takenKeys = new Set(taken.map((t) => t.y * 100 + t.m));
  if (months.some((m) => takenKeys.has(monthKey(m)))) return { error: "monthTaken" as ErrorKey, fieldErrors: { months: "monthTaken" as ErrorKey } };

  const id = crypto.randomUUID();
  const ext = receipt.file.type.split("/")[1];
  const key = `receipts/${member.id}/${id}.${ext}`;
  await env.MEDIA.put(key, receipt.file.stream(), { httpMetadata: { contentType: receipt.file.type } });

  try {
    await db.batch([
      db.insert(schema.contributions).values({
        id,
        memberId: member.id,
        amount: parsed.data.amount,
        monthlyRate: rate,
        memberKind: standing.kind,
        months: months.map((m: EthMonth) => [m.year, m.month] as [number, number]),
        reason: parsed.data.reason,
        receiptKey: key,
      }),
      ...months.map((m) =>
        db.insert(schema.contributionMonths).values({ contributionId: id, memberId: member.id, ethYear: m.year, ethMonth: m.month }),
      ),
    ]);
  } catch (e) {
    await env.MEDIA.delete(key);
    if (String(e).includes("UNIQUE")) return { error: "monthTaken" as ErrorKey, fieldErrors: { months: "monthTaken" as ErrorKey } };
    throw e;
  }

  notify(
    env,
    context.cloudflare.ctx,
    paymentSubmittedNotices(
      await recipientsWithRoles(db, ["finance"]),
      { id, name: member.fullName, amount: parsed.data.amount, months: months.map((m: EthMonth) => [m.year, m.month] as [number, number]) },
      env.PUBLIC_SITE_URL,
    ),
  );
  return redirect("/me?sent=1");
}

export default function Me({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const a = tr.account;
  const nav = useNavigation();
  const data = loaderData;

  if (!data.member) {
    return (
      <section className="page narrow">
        <h1>{a.title}</h1>
        <p>{a.notRegistered} <Link to="/register">{a.registerNow}</Link></p>
        <SignOut label={tr.nav.signOut} />
      </section>
    );
  }

  const { member } = data;
  const err = (k: string) => {
    const key = actionData?.fieldErrors?.[k as keyof typeof actionData.fieldErrors];
    return key ? (tr.errors[key] as string) : undefined;
  };

  return (
    <section className="page narrow">
      <h1>{a.title}</h1>
      {data.flags.registered && <p className="notice" role="status">{a.submitted}</p>}
      {data.flags.sent && <p className="notice" role="status">{a.sent}</p>}
      <p className={`status status-${member.status}`}>{a.status[member.status]}</p>

      {member.status === "active" && "months" in data && (
        <>
          <p><strong>{a.yourDue(data.rate)}</strong> · {standingLabel(lang, data.standing)}</p>
          <p className="me-links">
            {data.hasDepartment && <Link to="/tasks">{tr.tasks.title}</Link>}
            <Link to="/feedback">{a.feedbackLink}</Link>
          </p>

          <h2>{a.monthsTitle}</h2>
          <ul className="month-grid">
            {data.months.map((m) => (
              <li key={`${m.year}-${m.month}`} className={`month month--${m.status}`}>
                <span>{formatEth(lang, m)}</span>
                <small>{m.status === "approved" ? a.paid : m.status === "pending" ? a.pending : a.unpaid}</small>
              </li>
            ))}
          </ul>

          <h2>{a.payTitle}</h2>
          <p className="intro">{a.payIntro}</p>
          {actionData?.error && <p className="form-error" role="alert">{tr.errors[actionData.error] as string}</p>}
          <PayForm
            months={data.months.filter((m) => m.status === "unpaid")}
            rate={data.rate}
            err={err}
            submitting={nav.state === "submitting"}
          />

          {data.history.length > 0 && (
            <>
              <h2>{a.historyTitle}</h2>
              <ul className="history">
                {data.history.map((c) => (
                  <li key={c.id}>
                    <div>
                      <strong>{c.amount} {tr.birr}</strong> · {c.months.map(([y, m]) => formatEth(lang, { year: y, month: m })).join(", ")}
                      {c.reviewNote && <p className="row-note">{c.reviewNote}</p>}
                    </div>
                    <span className={`pill pill--${c.status}`}>{a.contribution[c.status]}</span>
                    <a href={`/receipts/${c.id}`} target="_blank" rel="noreferrer">{a.viewReceipt}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <SignOut label={tr.nav.signOut} />
    </section>
  );
}

function PayForm({
  months,
  rate,
  err,
  submitting,
}: {
  months: { year: number; month: number }[];
  rate: number;
  err: (k: string) => string | undefined;
  submitting: boolean;
}) {
  const { lang, tr } = useT();
  const a = tr.account;
  const [count, setCount] = useState(0);
  return (
    <Form method="post" encType="multipart/form-data" className="form">
      <fieldset className="field" aria-invalid={Boolean(err("months"))}>
        <legend>{a.selectMonths}</legend>
        <div className="choices choices--wrap">
          {months.map((m) => (
            <label key={`${m.year}-${m.month}`}>
              <input
                type="checkbox"
                name="months"
                value={`${m.year}-${m.month}`}
                onChange={(e) => setCount((c) => c + (e.currentTarget.checked ? 1 : -1))}
              />{" "}
              {formatEth(lang, m)}
            </label>
          ))}
        </div>
        {err("months") && <span className="field-error">{err("months")}</span>}
      </fieldset>
      <label className="field">
        <span>{a.amount} {count > 0 && <small>{a.expected(expectedAmount(rate, count))}</small>}</span>
        <input name="amount" type="number" inputMode="numeric" min={1} required aria-invalid={Boolean(err("amount"))} />
        {err("amount") && <span className="field-error">{err("amount")}</span>}
      </label>
      <label className="field">
        <span>{a.reason} <small>{tr.optional} · {a.reasonHint}</small></span>
        <textarea name="reason" rows={2} maxLength={300} />
      </label>
      <ReceiptInput label={a.receipt} hint={a.receiptHint} preparing={a.preparing} error={err("receipt")} />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{a.submit}</button>
    </Form>
  );
}

function SignOut({ label }: { label: string }) {
  const { tr } = useT();
  return (
    <>
    <p className="me-links"><Link to="/me/account">{tr.accountSettings.title} →</Link><Link to="/money">{tr.ledger.publicTitle} →</Link></p>
    <Form method="post" action="/logout" className="signout" onSubmit={markSignedOut}>
      <button className="btn btn-quiet">{label}</button>
    </Form>
    </>
  );
}
