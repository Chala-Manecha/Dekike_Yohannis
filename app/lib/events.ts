import { EVENT_VISIBLE_DAYS } from "../config";
import { addDaysIso, daysBetween, ethToIso } from "./dates";
import { addMonths, type EthDate, type EthMonth } from "./ethiopian";

export type EventType = "zikr" | "welcome" | "farewell" | "other";

/** Default zikr date for a month: the 30th (St. John the Baptist). */
export function defaultZikrIso(m: EthMonth) {
  return ethToIso({ year: m.year, month: m.month, day: 30 });
}

/** Months whose zikr should already exist: this month and the next two (Pagume never). */
export function zikrMonthsToEnsure(today: EthDate): EthMonth[] {
  const base: EthMonth = today.month === 13 ? addMonths({ year: today.year, month: 12 }, 1) : { year: today.year, month: today.month };
  return [0, 1, 2].map((i) => addMonths(base, i));
}

/** Homepage shows events from EVENT_VISIBLE_DAYS before until the day itself. */
export function isVisibleOnHome(eventIso: string, today: string) {
  const d = daysBetween(today, eventIso);
  return d >= 0 && d <= EVENT_VISIBLE_DAYS;
}

export function homeWindow(today: string) {
  return { from: today, to: addDaysIso(today, EVENT_VISIBLE_DAYS) };
}
