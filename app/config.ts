/** Group details. Edit names here; everything else reads from this file. */
export const GROUP = {
  telegramGroup: "https://t.me/bekidanu_eninur",
  nameEn: "St. John the Baptist Monthly Zikr", // browser tab title only
};

/** Starting dues in birr. Finance changes them in the app (/finance/settings). */
export const DEFAULT_DUES = { student: 30, graduate: 100 } as const;
export type Dues = { student: number; graduate: number };

export const ACADEMIC_DEPARTMENTS = ["cs", "it", "ee"] as const;
export type AcademicDepartment = (typeof ACADEMIC_DEPARTMENTS)[number];

/** Ethiopian month graduation happens in; from this month on, that class counts as graduates. 11 = Hamle. */
export const GRADUATION_MONTH = 11;

/** Events appear on the homepage this many days before they happen. */
export const EVENT_VISIBLE_DAYS = 3;
/** Unpaid members get a bot reminder each day from this many days before a zikr. */
export const REMINDER_DAYS_BEFORE = 3;

/** Max bot messages sent per cron run (Workers free plan: 50 outgoing requests per run). */
export const BOT_SEND_BATCH = 40;

export const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;
