import { Form, useSearchParams } from "react-router";
import { FinanceHead } from "../components/FinanceHead";
import { can } from "../lib/permissions";
import type { Route } from "./+types/finance.month";
import { Chips } from "../components/Chips";
import { ACADEMIC_DEPARTMENTS } from "../config";
import { getDb } from "../db";
import { countBy, matchesSearch, pickParam } from "../lib/dashboard";
import { addMonths, currentDueMonth, toEth, type EthMonth } from "../lib/ethiopian";
import { monthPayRows } from "../lib/finance.server";
import { formatEth, standingLabel } from "../lib/i18n";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

function parseMonth(v: string | null, fallback: EthMonth): EthMonth {
  const m = v?.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return fallback;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : fallback;
}

/** Every active member's dues for one month, filterable by department, student/graduate and status. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "finance:view");
  const today = toEth(new Date());
  const current = currentDueMonth(today);
  const selected = parseMonth(new URL(request.url).searchParams.get("m"), current);
  const { rows, collected } = await monthPayRows(getDb(env.DB), selected, today);
  const options = Array.from({ length: 12 }, (_, i) => addMonths(current, -i));
  return { selected, options, rows: rows.sort((a, b) => a.fullName.localeCompare(b.fullName)), collected, canSettings: can(user.role, "dues:set") };
}

const STATUSES = ["unpaid", "pending", "approved"] as const;

export default function FinanceMonth({ loaderData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const f = tr.finance;
  const d = tr.dashboard;
  const { rows: all, selected, options, collected } = loaderData;
  const [params] = useSearchParams();
  const dept = pickParam(params.get("dept"), ACADEMIC_DEPARTMENTS);
  const standing = pickParam(params.get("standing"), ["student", "graduate"] as const);
  const status = pickParam(params.get("status"), STATUSES);
  const q = params.get("q") ?? "";

  const searched = all.filter((m) => matchesSearch(q, [m.fullName, m.studentId, m.phone, m.telegramUsername]));
  const byDept = searched.filter((m) => (!standing || m.kind === standing) && (!status || m.status === status));
  const byStanding = searched.filter((m) => (!dept || m.department === dept) && (!status || m.status === status));
  const byStatus = searched.filter((m) => (!dept || m.department === dept) && (!standing || m.kind === standing));
  const rows = byDept.filter((m) => !dept || m.department === dept);
  const statusLabel = { unpaid: d.unpaid, pending: d.pending, approved: d.paid } as const;

  return (
    <section className="page wide">
      <FinanceHead active="month" canSettings={loaderData.canSettings} sub={`${f.monthTitle}: ${formatEth(lang, selected)}`} />
      <div className="card filter-card">
      <Form method="get" className="list-tools">
        {[...params.entries()].filter(([k]) => k !== "m" && k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <select name="m" defaultValue={`${selected.year}-${selected.month}`} aria-label={f.chooseMonth}>
          {options.map((o) => <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{formatEth(lang, o)}</option>)}
        </select>
        <input type="search" name="q" defaultValue={q} placeholder={tr.members.search} aria-label={tr.members.search} />
        <button className="btn btn-quiet btn-sm">{f.show}</button>
      </Form>

      <div className="mini-stats">
        <div className="mini-stat mini-stat--green"><strong>{collected.toLocaleString("en-US")} {tr.birr}</strong><span>{d.collected}</span></div>
        <div className="mini-stat"><strong>{all.filter((m) => m.status === "approved").length} / {all.length}</strong><span>{d.paid}</span></div>
        <div className="mini-stat mini-stat--red"><strong>{all.filter((m) => m.status === "unpaid").length}</strong><span>{d.unpaid}</span></div>
      </div>

      <Chips label={tr.members.status} param="status" value={status} allLabel={tr.members.all}
        options={STATUSES.map((s) => [s, statusLabel[s]])} counts={countBy(byStatus, STATUSES, (m) => m.status)} />
      <Chips label={tr.members.department} param="dept" value={dept} allLabel={tr.members.all}
        options={ACADEMIC_DEPARTMENTS.map((x) => [x, tr.dept[x]])} counts={countBy(byDept, ACADEMIC_DEPARTMENTS, (m) => m.department)} />
      <Chips label={tr.members.standing} param="standing" value={standing} allLabel={tr.members.all}
        options={[["student", d.students], ["graduate", d.graduates]]} counts={countBy(byStanding, ["student", "graduate"] as const, (m) => m.kind)} />
      </div>

      <div className="table-wrap">
        <table className="table-oneline">
          <thead>
            <tr><th>{tr.members.name}</th><th>ID</th><th>{tr.members.department}</th><th>{tr.members.standing}</th><th>{tr.members.status}</th><th>{tr.members.phone}</th><th>{tr.members.telegram}</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{tr.members.none}</td></tr>}
            {rows.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.fullName}</strong></td>
                <td>{m.studentId ?? "—"}</td>
                <td>{tr.dept[m.department]}</td>
                <td>{standingLabel(lang, m.standing)}</td>
                <td><span className={`pill pill--${m.status === "unpaid" ? "rejected" : m.status}`}>{statusLabel[m.status]}</span></td>
                <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
                <td>{m.telegramUsername ? <a href={`https://t.me/${m.telegramUsername}`} target="_blank" rel="noreferrer">@{m.telegramUsername}</a> : <span className="muted">{f.noTelegram}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
