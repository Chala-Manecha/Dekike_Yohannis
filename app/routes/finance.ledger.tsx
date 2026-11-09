import { desc, eq, isNull, and } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/finance.ledger";
import { EthDateFields } from "../components/EthDateFields";
import { Field } from "../components/Field";
import { ReceiptInput } from "../components/ReceiptInput";
import { getDb, schema } from "../db";
import { checkReceipt } from "../lib/contributions";
import { isoToEth, todayIso } from "../lib/dates";
import { currentDueMonth, toEth } from "../lib/ethiopian";
import { ethFieldsToIso } from "../lib/event-form";
import type { Dict } from "../lib/i18n";
import { formatEth } from "../lib/i18n";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, entrySchema, monthParam, monthlyTotals, nextEthMonth, parseMonthParam, prevEthMonth, voidSchema } from "../lib/ledger";
import { duesInMonth, entriesInMonth, loadMoneyItems } from "../lib/ledger.server";
import { eventTitle } from "../lib/notify";
import { can } from "../lib/permissions";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

type ErrorKey = keyof Dict["errors"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "finance:view");
  const db = getDb(env.DB);
  const today = toEth(new Date());
  const thisMonth = { year: today.year, month: today.month };
  const month = parseMonthParam(new URL(request.url).searchParams.get("m")) ?? thisMonth;

  const [items, entries, dues, events] = await Promise.all([
    loadMoneyItems(db),
    entriesInMonth(db, month),
    duesInMonth(db, month),
    db.select({ id: schema.events.id, type: schema.events.type, title: schema.events.title, date: schema.events.date }).from(schema.events).orderBy(desc(schema.events.date)).limit(30),
  ]);
  const totals = monthlyTotals(items, month);
  const t = totals.at(-1);
  const summary =
    t && t.year === month.year && t.month === month.month
      ? t
      : { opening: t?.closing ?? 0, dues: 0, otherIncome: 0, expense: 0, closing: t?.closing ?? 0 };

  return {
    month,
    isCurrent: month.year === thisMonth.year && month.month === thisMonth.month,
    prev: monthParam(prevEthMonth(month)),
    next: monthParam(nextEthMonth(month)),
    summary,
    dues,
    entries: entries.map((e) => ({ ...e, eth: isoToEth(e.date) })),
    events: events.map((e) => ({ ...e, eth: isoToEth(e.date) })),
    today,
    canWrite: can(user.role, "ledger:write"),
    dueMonthParam: monthParam(currentDueMonth(today)),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "ledger:write");
  const db = getDb(env.DB);
  const form = await request.formData();

  if (form.get("intent") === "void") {
    const parsed = voidSchema.safeParse({ reason: form.get("reason") });
    if (!parsed.success) return { error: "voidReason" as ErrorKey, fieldErrors: {} as Record<string, ErrorKey> };
    await db
      .update(schema.ledgerEntries)
      .set({ voidedAt: new Date(), voidedBy: user.id, voidReason: parsed.data.reason })
      .where(and(eq(schema.ledgerEntries.id, String(form.get("id"))), isNull(schema.ledgerEntries.voidedAt)));
    return { voided: true };
  }

  const parsed = entrySchema.safeParse({
    direction: form.get("direction"),
    category: form.get("category"),
    amount: form.get("amount"),
    description: form.get("description"),
    eventId: form.get("eventId") ?? undefined,
  });
  const fieldErrors: Record<string, ErrorKey> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message as ErrorKey;
  const date = ethFieldsToIso(Number(form.get("ethYear")), Number(form.get("ethMonth")), Number(form.get("ethDay")));
  if (!date) fieldErrors.date = "badDate";
  else if (date > todayIso()) fieldErrors.date = "futureDate";

  // Receipt is optional (small cash purchases may have none) but shown as missing to the leader
  const file = form.get("receipt");
  const hasFile = file instanceof File && file.size > 0;
  const receipt = hasFile ? checkReceipt(file) : null;
  if (receipt && !receipt.ok) fieldErrors.receipt = receipt.error as ErrorKey;
  if (!parsed.success || Object.keys(fieldErrors).length) return { error: "fixFields" as ErrorKey, fieldErrors };

  const id = crypto.randomUUID();
  let receiptKey: string | null = null;
  if (receipt?.ok) {
    receiptKey = `ledger/${id}.${receipt.file.type.split("/")[1]}`;
    await env.MEDIA.put(receiptKey, receipt.file.stream(), { httpMetadata: { contentType: receipt.file.type } });
  }
  try {
    await db.insert(schema.ledgerEntries).values({ id, ...parsed.data, date: date!, receiptKey, createdBy: user.id });
  } catch (e) {
    if (receiptKey) await env.MEDIA.delete(receiptKey);
    throw e;
  }
  return { added: true };
}

export default function Ledger({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const l = tr.ledger;
  const busy = useNavigation().state !== "idle";
  const { month, summary, dues, entries, events, today, canWrite } = loaderData;
  const birr = (n: number) => `${n.toLocaleString("en-US")} ${tr.birr}`;
  const fe = actionData && "fieldErrors" in actionData ? actionData.fieldErrors : {};
  const err = (k: string) => (fe?.[k] ? (tr.errors[fe[k]] as string) : undefined);

  return (
    <section className="page wide">
      <p><Link to="/finance">← {tr.finance.title}</Link></p>
      <h1>{l.title}</h1>

      <nav className="month-nav" aria-label={l.month}>
        <Link to={`?m=${loaderData.prev}`} aria-label={l.prev}>←</Link>
        <strong>{formatEth(lang, month)}</strong>
        {!loaderData.isCurrent && <Link to={`?m=${loaderData.next}`} aria-label={l.next}>→</Link>}
        <a className="btn btn-quiet btn-sm" href={`/finance/ledger.csv?m=${monthParam(month)}`}>{l.csv}</a>
      </nav>

      <div className="money-summary">
        <div><span>{l.opening}</span><strong>{birr(summary.opening)}</strong></div>
        <div><span>{l.dues}</span><strong className="money-in">{summary.dues ? "+" : ""}{birr(summary.dues)}</strong></div>
        <div><span>{l.otherIncome}</span><strong className="money-in">{summary.otherIncome ? "+" : ""}{birr(summary.otherIncome)}</strong></div>
        <div><span>{l.expense}</span><strong className="money-out">{summary.expense ? "−" : ""}{birr(summary.expense)}</strong></div>
        <div className="money-closing"><span>{l.closing}</span><strong>{birr(summary.closing)}</strong></div>
      </div>

      {actionData && "added" in actionData && <p className="notice" role="status">{l.added}</p>}
      {actionData && "voided" in actionData && <p className="notice" role="status">{l.voided}</p>}

      <div className="table-wrap">
        <table className="ledger">
          <thead><tr><th>{l.date}</th><th>{l.category}</th><th>{l.description}</th><th className="num">{l.amount}</th><th>{l.receipt}</th>{canWrite && <th />}</tr></thead>
          <tbody>
            {dues.count > 0 && (
              <tr>
                <td>—</td>
                <td>{l.dues}</td>
                <td><Link to="/finance/month">{l.duesLine(dues.count)}</Link></td>
                <td className="num money-in">+{dues.total.toLocaleString("en-US")}</td>
                <td>—</td>
                {canWrite && <td />}
              </tr>
            )}
            {entries.length === 0 && dues.count === 0 && <tr><td colSpan={6} className="muted">{l.none}</td></tr>}
            {entries.map((e) => (
              <tr key={e.id} className={e.voidedAt ? "is-void" : ""}>
                <td>{e.eth.day} {tr.months[e.eth.month - 1]}</td>
                <td>{l.categories[e.category as keyof typeof l.categories] ?? e.category}</td>
                <td>
                  {e.description}
                  {e.voidedAt && <small className="void-note">{l.voidedBecause}: {e.voidReason}</small>}
                </td>
                <td className={`num ${e.direction === "in" ? "money-in" : "money-out"}`}>{e.direction === "in" ? "+" : "−"}{e.amount.toLocaleString("en-US")}</td>
                <td>{e.receiptKey ? <a href={`/finance/ledger/${e.id}/receipt`} target="_blank" rel="noreferrer">{l.view}</a> : <span className="muted">{l.noReceipt}</span>}</td>
                {canWrite && (
                  <td>
                    {!e.voidedAt && (
                      <details className="void">
                        <summary>{l.void}</summary>
                        <Form method="post" className="inline-form">
                          <input type="hidden" name="intent" value="void" />
                          <input type="hidden" name="id" value={e.id} />
                          <input name="reason" placeholder={l.voidReason} required minLength={3} maxLength={200} />
                          <button className="btn btn-quiet btn-sm" disabled={busy}>{l.void}</button>
                        </Form>
                      </details>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <section className="panel" aria-labelledby="add-h">
          <h2 id="add-h">{l.add}</h2>
          {actionData && "error" in actionData && actionData.error && <p className="form-error" role="alert">{tr.errors[actionData.error] as string}</p>}
          <Form method="post" encType="multipart/form-data" className="form" key={actionData && "added" in actionData ? "reset" : "form"}>
            <fieldset className="field">
              <legend>{l.direction}</legend>
              <div className="choices">
                <label><input type="radio" name="direction" value="out" defaultChecked /> {l.out}</label>
                <label><input type="radio" name="direction" value="in" /> {l.in}</label>
              </div>
            </fieldset>
            <label className="field">
              <span>{l.category}</span>
              <select name="category" aria-invalid={Boolean(err("category"))}>
                <optgroup label={l.out}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{l.categories[c]}</option>)}</optgroup>
                <optgroup label={l.in}>{INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{l.categories[c]}</option>)}</optgroup>
              </select>
              {err("category") && <span className="field-error">{l.categoryMismatch}</span>}
            </label>
            <Field label={`${l.amount} (${tr.birr})`} name="amount" inputMode="numeric" required error={err("amount")} />
            <EthDateFields value={today} error={err("date")} />
            <Field label={l.description} hint={l.descriptionHint} name="description" required maxLength={200} error={err("description")} />
            <label className="field">
              <span>{l.event} <small>{tr.optional}</small></span>
              <select name="eventId" defaultValue="">
                <option value="">—</option>
                {events.map((e) => <option key={e.id} value={e.id}>{eventTitle(lang, e)} · {formatEth(lang, e.eth)}</option>)}
              </select>
            </label>
            <ReceiptInput label={l.receipt} hint={l.receiptHint} preparing={tr.account.preparing} error={err("receipt")} required={false} />
            <button className="btn btn-primary" disabled={busy}>{tr.save}</button>
          </Form>
        </section>
      )}
    </section>
  );
}
