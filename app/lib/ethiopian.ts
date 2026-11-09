/**
 * Ethiopian (Ge'ez) calendar <-> Gregorian, via Julian Day Numbers.
 * 12 months of 30 days + Pagume (month 13) with 5 days, 6 in a leap year
 * (Ethiopian year where year % 4 === 3).
 */
export type EthDate = { year: number; month: number; day: number };

const ETH_EPOCH = 1723856; // JDN offset for the Amete Mihret era

export function gregorianToJdn(y: number, m: number, d: number) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

export function jdnToGregorian(jdn: number) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

export function ethToJdn({ year, month, day }: EthDate) {
  return ETH_EPOCH + 365 + 365 * (year - 1) + Math.floor(year / 4) + 30 * month + day - 31;
}

export function jdnToEth(jdn: number): EthDate {
  const r = (jdn - ETH_EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - ETH_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

/** Ethiopian date for a JS Date, using East Africa Time (UTC+3). */
export function toEth(date: Date): EthDate {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return jdnToEth(gregorianToJdn(eat.getUTCFullYear(), eat.getUTCMonth() + 1, eat.getUTCDate()));
}

/** Gregorian date (UTC midnight) for an Ethiopian date. */
export function ethToDate(eth: EthDate): Date {
  const g = jdnToGregorian(ethToJdn(eth));
  return new Date(Date.UTC(g.year, g.month - 1, g.day));
}

/** Months that carry a zikr and a contribution: 1–12. Pagume (13) has no 30th. */
export const DUE_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type EthMonth = { year: number; month: number };

export function monthKey(m: EthMonth) {
  return m.year * 100 + m.month;
}

export function addMonths(m: EthMonth, n: number): EthMonth {
  const idx = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** The contribution month "now": Pagume counts as the month before it (Nehase). */
export function currentDueMonth(today: EthDate): EthMonth {
  return today.month === 13 ? { year: today.year, month: 12 } : { year: today.year, month: today.month };
}

/** Next default zikr: the 30th of this month, or of the next month if passed. Skips Pagume. */
export function nextZikr(today: EthDate): EthDate {
  if (today.month <= 12 && today.day <= 30) return { year: today.year, month: today.month, day: 30 };
  const next = today.month >= 12 ? { year: today.year + 1, month: 1 } : { year: today.year, month: today.month + 1 };
  return { ...next, day: 30 };
}
