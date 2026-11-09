import type { Route } from "./+types/finance.ledger.csv";
import { getDb } from "../db";
import { toEth } from "../lib/ethiopian";
import { isoToEth } from "../lib/dates";
import { t } from "../lib/i18n";
import { langFromCookie } from "../lib/lang";
import { monthParam, monthlyTotals, parseMonthParam, toCsv } from "../lib/ledger";
import { duesInMonth, entriesInMonth, loadMoneyItems } from "../lib/ledger.server";
import { requirePermission } from "../lib/session.server";

/** One Ethiopian month of the ledger as CSV (opens in Excel), in the viewer's language. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "finance:view");
  const db = getDb(env.DB);
  const today = toEth(new Date());
  const month = parseMonthParam(new URL(request.url).searchParams.get("m")) ?? { year: today.year, month: today.month };
  const tr = t(langFromCookie(request.headers.get("Cookie")));
  const l = tr.ledger;
  const [items, entries, dues] = await Promise.all([loadMoneyItems(db), entriesInMonth(db, month), duesInMonth(db, month)]);
  const s = monthlyTotals(items, month).find((m) => m.year === month.year && m.month === month.month);

  const rows: (string | number | null)[][] = [
    [l.date, l.category, l.description, l.in, l.out, l.receipt, l.voidedBecause],
    ...(dues.count ? [["", l.dues, l.duesLine(dues.count), dues.total, null, null, null]] : []),
    ...entries.map((e) => {
      const d = isoToEth(e.date);
      return [
        `${d.day}/${d.month}/${d.year}`,
        l.categories[e.category as keyof typeof l.categories] ?? e.category,
        e.description,
        e.direction === "in" ? e.amount : null,
        e.direction === "out" ? e.amount : null,
        e.receiptKey ? "✓" : "",
        e.voidedAt ? e.voidReason : null,
      ];
    }),
    [],
    [l.opening, null, null, s?.opening ?? null],
    [l.closing, null, null, s?.closing ?? null],
  ];
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-${monthParam(month)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
