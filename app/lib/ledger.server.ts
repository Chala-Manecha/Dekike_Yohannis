import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { schema, type Db } from "../db";
import { ethToIso, todayIso } from "./dates";
import type { EthMonth } from "./ethiopian";
import { nextEthMonth, type MoneyItem } from "./ledger";

/** Every money movement: approved dues (dated the day Finance approved them) + ledger entries not voided. */
export async function loadMoneyItems(db: Db): Promise<MoneyItem[]> {
  const [dues, entries] = await Promise.all([
    db
      .select({ amount: schema.contributions.amount, at: schema.contributions.reviewedAt })
      .from(schema.contributions)
      .where(eq(schema.contributions.status, "approved")),
    db
      .select({ date: schema.ledgerEntries.date, direction: schema.ledgerEntries.direction, amount: schema.ledgerEntries.amount })
      .from(schema.ledgerEntries)
      .where(isNull(schema.ledgerEntries.voidedAt)),
  ]);
  return [
    ...dues.filter((d) => d.at).map((d) => ({ date: todayIso(d.at!), direction: "in" as const, amount: d.amount, dues: true })),
    ...entries,
  ];
}

/** ISO date range [from, to) covering one Ethiopian month. */
export function monthRange(m: EthMonth) {
  const next = nextEthMonth(m);
  return { from: ethToIso({ ...m, day: 1 }), to: ethToIso({ ...next, day: 1 }) };
}

export async function entriesInMonth(db: Db, m: EthMonth) {
  const { from, to } = monthRange(m);
  return db
    .select()
    .from(schema.ledgerEntries)
    .where(and(gte(schema.ledgerEntries.date, from), lt(schema.ledgerEntries.date, to)))
    .orderBy(schema.ledgerEntries.date, schema.ledgerEntries.createdAt);
}

/** Approved dues in the month (by approval day): count and total. */
export async function duesInMonth(db: Db, m: EthMonth) {
  const { from, to } = monthRange(m);
  // reviewedAt is a timestamp; convert the Addis day boundaries (UTC+3) to instants
  const start = new Date(Date.parse(from + "T00:00:00Z") - 3 * 3600_000);
  const end = new Date(Date.parse(to + "T00:00:00Z") - 3 * 3600_000);
  const rows = await db
    .select({ amount: schema.contributions.amount })
    .from(schema.contributions)
    .where(and(eq(schema.contributions.status, "approved"), gte(schema.contributions.reviewedAt, start), lt(schema.contributions.reviewedAt, end)));
  return { count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) };
}
