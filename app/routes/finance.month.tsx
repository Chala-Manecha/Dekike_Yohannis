import { and, eq } from "drizzle-orm";
import { Form, Link } from "react-router";
import type { Route } from "./+types/finance.month";
import { getDb, schema } from "../db";
import { addMonths, currentDueMonth, toEth, type EthMonth } from "../lib/ethiopian";
import { formatEth, standingLabel } from "../lib/i18n";
import { classInfo } from "../lib/classyear";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

function parseMonth(v: string | null, fallback: EthMonth): EthMonth {
  const m = v?.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return fallback;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : fallback;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "finance:view");
  const current = currentDueMonth(toEth(new Date()));
  const selected = parseMonth(new URL(request.url).searchParams.get("m"), current);
  const db = getDb(env.DB);

  const activeMembers = await db
    .select({
      id: schema.members.id,
      fullName: schema.members.fullName,
      department: schema.members.department,
      graduationYear: schema.members.graduationYear,
      studyYear: schema.members.studyYear,
      registeredYear: schema.members.registeredYear,
      phone: schema.members.phone,
      telegramUsername: schema.user.telegramUsername,
    })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(eq(schema.members.status, "active"));

  const claims = await db
    .select({
      memberId: schema.contributionMonths.memberId,
      status: schema.contributions.status,
      amount: schema.contributions.amount,
      monthsCount: schema.contributions.months,
    })
    .from(schema.contributionMonths)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionMonths.contributionId))
    .where(and(eq(schema.contributionMonths.ethYear, selected.year), eq(schema.contributionMonths.ethMonth, selected.month)));

  const byMember = new Map(claims.map((c) => [c.memberId, c]));
  // A payment covering several months is split evenly across them for the monthly total.
  const collected = claims
    .filter((c) => c.status === "approved")
    .reduce((sum, c) => sum + c.amount / c.monthsCount.length, 0);

  const today = toEth(new Date());
  const rows = activeMembers.map((m) => ({ ...m, standing: classInfo(m, today), status: byMember.get(m.id)?.status ?? "unpaid" }));
  const options = Array.from({ length: 12 }, (_, i) => addMonths(current, -i));
  return { selected, options, rows, collected: Math.round(collected) };
}

export default function FinanceMonth({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const f = tr.finance;
  const { rows, selected, options, collected } = loaderData;
  const paid = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "pending");
  const unpaid = rows.filter((r) => r.status === "unpaid");

  return (
    <section className="page wide">
      <p><Link to="/finance">← {f.title}</Link></p>
      <h1>{f.monthTitle}: {formatEth(lang, selected)}</h1>
      <Form method="get" className="inline-form">
        <label>
          {f.chooseMonth}{" "}
          <select name="m" defaultValue={`${selected.year}-${selected.month}`}>
            {options.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{formatEth(lang, o)}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-quiet btn-sm">{f.show}</button>
      </Form>

      <dl className="stats">
        <div><dt>{f.collected}</dt><dd>{collected} {tr.birr}</dd></div>
        <div><dt>{f.paidCount}</dt><dd>{paid.length}</dd></div>
        <div><dt>{f.pendingCount}</dt><dd>{pending.length}</dd></div>
        <div><dt>{f.unpaidCount}</dt><dd>{unpaid.length}</dd></div>
      </dl>

      <h2>{f.unpaidList}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>{tr.members.name}</th><th>{tr.members.department}</th><th>{tr.members.standing}</th><th>{tr.members.phone}</th><th>{tr.members.telegram}</th></tr>
          </thead>
          <tbody>
            {unpaid.map((m) => (
              <tr key={m.id}>
                <td>{m.fullName}</td>
                <td>{tr.dept[m.department]}</td>
                <td>{standingLabel(lang, m.standing)}</td>
                <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
                <td>
                  {m.telegramUsername ? (
                    <a href={`https://t.me/${m.telegramUsername}`} target="_blank" rel="noreferrer">{f.contact}</a>
                  ) : (
                    <span className="muted">{f.noTelegram}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
