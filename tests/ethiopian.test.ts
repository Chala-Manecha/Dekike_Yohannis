import { describe, expect, it } from "vitest";
import { addMonths, currentDueMonth, ethToDate, jdnToEth, nextZikr, toEth, gregorianToJdn, ethToJdn } from "../app/lib/ethiopian";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("Ethiopian calendar", () => {
  it.each([
    // Ethiopian new year (Meskerem 1)
    [{ year: 2017, month: 1, day: 1 }, "2024-09-11"],
    [{ year: 2016, month: 1, day: 1 }, "2023-09-12"], // after leap Pagume 6
    [{ year: 2018, month: 1, day: 1 }, "2025-09-11"],
    // Genna (Tahsas 29) and Timket (Tir 11)
    [{ year: 2017, month: 4, day: 29 }, "2025-01-07"],
    [{ year: 2017, month: 5, day: 11 }, "2025-01-19"],
    // Pagume 6 in leap year 2015
    [{ year: 2015, month: 13, day: 6 }, "2023-09-11"],
  ])("%o is %s", (eth, greg) => {
    expect(iso(ethToDate(eth))).toBe(greg);
    const [y, m, d] = greg.split("-").map(Number);
    expect(jdnToEth(gregorianToJdn(y, m, d))).toEqual(eth);
  });

  it("round-trips every day across several years", () => {
    const start = gregorianToJdn(2022, 1, 1);
    for (let j = start; j < start + 365 * 6; j++) expect(ethToJdn(jdnToEth(j))).toBe(j);
  });

  it("uses Addis time: 22:00 UTC is already the next day", () => {
    expect(toEth(new Date("2024-09-10T22:00:00Z"))).toEqual({ year: 2017, month: 1, day: 1 });
    expect(toEth(new Date("2024-09-10T20:00:00Z"))).toEqual({ year: 2016, month: 13, day: 5 });
  });
});

describe("zikr and due months", () => {
  it("next zikr is the 30th of this month, skipping Pagume", () => {
    expect(nextZikr({ year: 2018, month: 3, day: 12 })).toEqual({ year: 2018, month: 3, day: 30 });
    expect(nextZikr({ year: 2018, month: 3, day: 30 })).toEqual({ year: 2018, month: 3, day: 30 });
    expect(nextZikr({ year: 2017, month: 13, day: 2 })).toEqual({ year: 2018, month: 1, day: 30 });
  });
  it("Pagume counts toward Nehase's contribution", () => {
    expect(currentDueMonth({ year: 2017, month: 13, day: 3 })).toEqual({ year: 2017, month: 12 });
  });
  it("adds months across the year boundary without Pagume", () => {
    expect(addMonths({ year: 2017, month: 12 }, 1)).toEqual({ year: 2018, month: 1 });
    expect(addMonths({ year: 2018, month: 1 }, -1)).toEqual({ year: 2017, month: 12 });
    expect(addMonths({ year: 2018, month: 5 }, -5)).toEqual({ year: 2017, month: 12 });
  });
});
