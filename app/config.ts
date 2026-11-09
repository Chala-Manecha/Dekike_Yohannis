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

/**
 * Months Ambo University graduates in (Ethiopian month numbers): 5 = Tir, 9 = Ginbot.
 * Each member says which one; from that month on they count as a graduate.
 */
export const GRADUATION_MONTHS = [5, 9] as const;
export type GraduationMonth = (typeof GRADUATION_MONTHS)[number];

/** Length of each programme in years. */
export const PROGRAM_YEARS = { cs: 4, it: 4, ee: 5 } as const satisfies Record<AcademicDepartment, number>;

/** Events appear on the homepage this many days before they happen. */
export const EVENT_VISIBLE_DAYS = 3;
/** Unpaid members get a bot reminder each day from this many days before a zikr. */
export const REMINDER_DAYS_BEFORE = 3;

/** Max bot messages sent per cron run (Workers free plan: 50 outgoing requests per run). */
export const BOT_SEND_BATCH = 40;

export const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;
