import { describe, expect, it } from "vitest";
import { entrySchema, monthlyTotals, nextEthMonth, parseMonthParam, prevEthMonth, toCsv } from "../app/lib/ledger";

// Gregorian dates and their Ethiopian months (2019 E.C.):
// 2026-10-11 = Tikimt 1, 2026-11-10 = Hidar 1, 2026-12-10 = Tahsas 1
describe("monthlyTotals", () => {
  const items = [
    { date: "2026-10-12", direction: "in" as const, amount: 1000 }, // opening, Tikimt
    { date: "2026-10-20", direction: "in" as const, amount: 300, dues: true },
    { date: "2026-10-25", direction: "out" as const, amount: 450 },
    { date: "2026-12-15", direction: "in" as const, amount: 130, dues: true }, // Tahsas
  ];
  it("adds up each month and carries the balance through empty months", () => {
    const t = monthlyTotals(items, { year: 2019, month: 4 });
    expect(t.map((m) => m.month)).toEqual([2, 3, 4]);
    expect(t[0]).toMatchObject({ opening: 0, dues: 300, otherIncome: 1000, expense: 450, closing: 850 });
    expect(t[1]).toMatchObject({ opening: 850, dues: 0, expense: 0, closing: 850 });
    expect(t[2]).toMatchObject({ opening: 850, dues: 130, closing: 980 });
  });
  it("ignores money after the chosen month", () => {
    expect(monthlyTotals(items, { year: 2019, month: 2 }).at(-1)?.closing).toBe(850);
  });
  it("is empty with no money", () => {
    expect(monthlyTotals([], { year: 2019, month: 2 })).toEqual([]);
  });
});

describe("months", () => {
  it("includes Pagume and wraps years", () => {
    expect(nextEthMonth({ year: 2018, month: 12 })).toEqual({ year: 2018, month: 13 });
    expect(nextEthMonth({ year: 2018, month: 13 })).toEqual({ year: 2019, month: 1 });
    expect(prevEthMonth({ year: 2019, month: 1 })).toEqual({ year: 2018, month: 13 });
  });
  it("reads the month from the URL", () => {
    expect(parseMonthParam("201903")).toEqual({ year: 2019, month: 3 });
    expect(parseMonthParam("201914")).toBeNull();
    expect(parseMonthParam("abc")).toBeNull();
  });
});

describe("entrySchema", () => {
  const ok = { direction: "out", category: "supplies", amount: "250", description: "Candles and incense" };
  it("accepts a valid expense", () => {
    expect(entrySchema.parse(ok)).toMatchObject({ amount: 250, eventId: null });
  });
  it("needs a category that matches money in or out", () => {
    expect(entrySchema.safeParse({ ...ok, category: "donation" }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, direction: "in", category: "donation" }).success).toBe(true);
  });
  it("rejects bad amounts and empty descriptions", () => {
    expect(entrySchema.safeParse({ ...ok, amount: "0" }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, amount: "12.5" }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, description: " " }).success).toBe(false);
  });
});

describe("toCsv", () => {
  it("quotes cells and defuses formulas", () => {
    expect(toCsv([["a,b", 5, null], ['=HYPERLINK("x")', "say \"hi\"", "-3"]])).toBe('﻿"a,b","5",""\r\n"\'=HYPERLINK(""x"")","say ""hi""","\'-3"');
  });
});
