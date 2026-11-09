import { ethToDate, toEth, type EthDate } from "./ethiopian";

/** Dates are handled as Addis Ababa calendar days in ISO form: "2026-11-09". */
export function todayIso(now = new Date()) {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86_400_000);
}

export function ethToIso(eth: EthDate) {
  return ethToDate(eth).toISOString().slice(0, 10);
}

export function isoToEth(iso: string): EthDate {
  // Noon UTC is the same calendar day in Addis, so toEth's +3h never crosses midnight
  return toEth(new Date(iso + "T09:00:00Z"));
}

/** Hour of day in Addis Ababa (0–23). */
export function eatHour(now = new Date()) {
  return (now.getUTCHours() + 3) % 24;
}
