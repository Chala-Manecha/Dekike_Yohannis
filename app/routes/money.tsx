import { eq } from "drizzle-orm";
import { Link } from "react-router";
import type { Route } from "./+types/money";
import { getDb, schema } from "../db";
import { toEth } from "../lib/ethiopian";
import { formatEth } from "../lib/i18n";
import { monthlyTotals } from "../lib/ledger";
import { loadMoneyItems } from "../lib/ledger.server";
import { can } from "../lib/permissions";
import { requireUser } from "../lib/session.server";
import { useT } from "../lib/use-t";

const MONTHS_SHOWN = 12;

/** Transparency for members: monthly totals and the balance, no individual entries or receipts. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { status: true } });
  const finance = can(user.role, "finance:view");
  if (member?.status !== "active" && !finance) return { allowed: false as const };
  const today = toEth(new Date());
  const totals = monthlyTotals(await loadMoneyItems(db), { year: today.year, month: today.month });
  return { allowed: true as const, finance, months: totals.slice(-MONTHS_SHOWN).reverse(), balance: totals.at(-1)?.closing ?? 0 };
}

export default function Money({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const l = tr.ledger;
  const birr = (n: number) => n.toLocaleString("en-US");
  if (!loaderData.allowed) {
    return (
      <section className="page narrow">
        <h1>{l.publicTitle}</h1>
        <p>{tr.feedback.onlyMembers}</p>
      </section>
    );
  }
  const { months, balance, finance } = loaderData;
  return (
    <section className="page">
      <h1>{l.publicTitle}</h1>
      <p className="intro">{l.publicIntro}</p>
      {finance && <p><Link to="/finance/ledger">{l.title} →</Link></p>}
      <div className="money-summary">
        <div className="money-closing"><span>{l.balanceNow}</span><strong>{birr(balance)} {tr.birr}</strong></div>
      </div>
      {months.length === 0 ? <p className="muted">{l.none}</p> : (
        <div className="table-wrap">
          <table className="ledger">
            <thead><tr><th>{l.month}</th><th className="num">{l.dues}</th><th className="num">{l.otherIncome}</th><th className="num">{l.expense}</th><th className="num">{l.closing}</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.year * 100 + m.month}>
                  <td>{formatEth(lang, m)}</td>
                  <td className="num money-in">{birr(m.dues)}</td>
                  <td className="num money-in">{birr(m.otherIncome)}</td>
                  <td className="num money-out">{birr(m.expense)}</td>
                  <td className="num"><strong>{birr(m.closing)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
