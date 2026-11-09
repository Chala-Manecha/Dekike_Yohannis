/**
 * Numbers for the dashboards and the filter buttons on the lists. Pure, tested in tests/dashboard.test.ts.
 */
import type { AcademicDepartment } from "../config";
import { ACADEMIC_DEPARTMENTS } from "../config";

export type PayStatus = "approved" | "pending" | "unpaid";
export type Kind = "student" | "graduate";
export type PayRow = { department: AcademicDepartment; kind: Kind; status: PayStatus };

export type Cell = { members: number; paid: number; pending: number; unpaid: number };
const empty = (): Cell => ({ members: 0, paid: 0, pending: 0, unpaid: 0 });

/** Payments this month by academic department × student/graduate, plus totals. */
export function paymentBreakdown(rows: PayRow[]) {
  const table = Object.fromEntries(ACADEMIC_DEPARTMENTS.map((d) => [d, { student: empty(), graduate: empty() }])) as Record<AcademicDepartment, Record<Kind, Cell>>;
  const total = empty();
  for (const r of rows) {
    for (const c of [table[r.department][r.kind], total]) {
      c.members++;
      if (r.status === "approved") c.paid++;
      else if (r.status === "pending") c.pending++;
      else c.unpaid++;
    }
  }
  return { table, total };
}

/** Counts for filter buttons, e.g. { all: 40, cs: 12, it: 10, ee: 18 }. */
export function countBy<T, K extends string>(rows: T[], keys: readonly K[], pick: (r: T) => string): Record<K | "all", number> {
  const out = { all: rows.length } as Record<K | "all", number>;
  for (const k of keys) out[k] = 0;
  for (const r of rows) {
    const k = pick(r) as K;
    if (k in out) out[k]++;
  }
  return out;
}

/** Only the given (valid) value of a URL filter, else null. */
export function pickParam<K extends string>(value: string | null, allowed: readonly K[]): K | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as K) : null;
}

/** Simple contains-search over a few fields, case-insensitive; IDs ignore slashes/spaces. */
export function matchesSearch(q: string, fields: (string | null | undefined)[]) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const compact = needle.replace(/[^a-z0-9]/g, "");
  return fields.some((f) => {
    if (!f) return false;
    const v = f.toLowerCase();
    return v.includes(needle) || (compact.length >= 3 && v.replace(/[^a-z0-9]/g, "").includes(compact));
  });
}

/**
 * Attendance changes from the event's checklist: who to add and who to remove,
 * given who was ticked before and who is ticked now (only active members count).
 */
export function attendanceDiff(before: string[], ticked: string[], activeIds: Set<string>) {
  const was = new Set(before);
  const now = new Set(ticked.filter((id) => activeIds.has(id)));
  return { add: [...now].filter((id) => !was.has(id)), remove: [...was].filter((id) => !now.has(id)) };
}
