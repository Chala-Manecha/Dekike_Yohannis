/**
 * Money in and out. Approved dues count as income automatically (on the day Finance
 * approved them); everything else is a ledger entry recorded by Finance. Totals are by
 * Ethiopian month (Pagume is its own month). Pure, tested in tests/ledger.test.ts.
 */
import { z } from "zod";
import { isoToEth } from "./dates";
import { monthKey, type EthMonth } from "./ethiopian";

export const INCOME_CATEGORIES = ["opening", "donation", "event_income", "other_income"] as const;
export const EXPENSE_CATEGORIES = ["event", "supplies", "charity", "transport", "other_expense"] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type LedgerCategory = IncomeCategory | ExpenseCategory;

export const MAX_AMOUNT = 10_000_000;

export const entrySchema = z
  .object({
    direction: z.enum(["in", "out"], { message: "choose" }),
    category: z.enum([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES], { message: "choose" }),
    amount: z.coerce.number({ message: "amount" }).int("amount").min(1, "amount").max(MAX_AMOUNT, "amount"),
    description: z.string().trim().min(3, "description").max(200, "description"),
    eventId: z
      .string()
      .optional()
      .transform((s) => s || null),
  })
  .refine((e) => (e.direction === "in" ? (INCOME_CATEGORIES as readonly string[]) : (EXPENSE_CATEGORIES as readonly string[])).includes(e.category), {
    message: "choose",
    path: ["category"],
  });

export const voidSchema = z.object({ reason: z.string().trim().min(3, "voidReason").max(200, "voidReason") });

export type MoneyItem = { date: string; direction: "in" | "out"; amount: number; dues?: boolean };

export type MonthTotals = EthMonth & { opening: number; dues: number; otherIncome: number; expense: number; closing: number };

export function ethMonthOf(iso: string): EthMonth {
  const e = isoToEth(iso);
  return { year: e.year, month: e.month };
}

export function nextEthMonth(m: EthMonth): EthMonth {
  return m.month >= 13 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 };
}

export function prevEthMonth(m: EthMonth): EthMonth {
  return m.month <= 1 ? { year: m.year - 1, month: 13 } : { year: m.year, month: m.month - 1 };
}

/** "201903" → { year: 2019, month: 3 } (months 1–13). */
export function parseMonthParam(v: string | null): EthMonth | null {
  if (!v || !/^\d{6}$/.test(v)) return null;
  const year = Number(v.slice(0, 4));
  const month = Number(v.slice(4));
  return month >= 1 && month <= 13 ? { year, month } : null;
}

export const monthParam = (m: EthMonth) => String(monthKey(m));

/**
 * Totals for every month from the first money movement up to `until`, with a running balance.
 * Months without movement are included so the balance carries over.
 */
export function monthlyTotals(items: MoneyItem[], until: EthMonth): MonthTotals[] {
  const byMonth = new Map<number, { dues: number; otherIncome: number; expense: number }>();
  let first: EthMonth | null = null;
  for (const it of items) {
    const m = ethMonthOf(it.date);
    if (monthKey(m) > monthKey(until)) continue;
    if (!first || monthKey(m) < monthKey(first)) first = m;
    const t = byMonth.get(monthKey(m)) ?? { dues: 0, otherIncome: 0, expense: 0 };
    if (it.direction === "out") t.expense += it.amount;
    else if (it.dues) t.dues += it.amount;
    else t.otherIncome += it.amount;
    byMonth.set(monthKey(m), t);
  }
  if (!first) return [];
  const out: MonthTotals[] = [];
  let balance = 0;
  for (let m = first; monthKey(m) <= monthKey(until); m = nextEthMonth(m)) {
    const t = byMonth.get(monthKey(m)) ?? { dues: 0, otherIncome: 0, expense: 0 };
    const closing = balance + t.dues + t.otherIncome - t.expense;
    out.push({ ...m, opening: balance, ...t, closing });
    balance = closing;
  }
  return out;
}

/** CSV for Finance (Excel opens it). Quotes every field; prefixes formulas so Excel won't run them. */
export function toCsv(rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@]/.test(s) && typeof v === "string") s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  // BOM so Excel reads Amharic/Oromo correctly
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
