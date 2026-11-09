import { PROGRAM_YEARS, type AcademicDepartment, type Dues } from "../config";
import type { EthDate } from "./ethiopian";

export type ClassFields = {
  graduationYear: number; // Ethiopian year
  graduationMonth: number; // Ethiopian month (5 = Tir, 9 = Ginbot)
  studyYear: number | null; // year of study when they registered (null if already graduated)
  registeredYear: number; // Ethiopian year they registered
};

export type ClassInfo =
  | { kind: "graduate"; graduationYear: number }
  | { kind: "student"; year: number; gc: boolean; graduationYear: number };

export function hasGraduated(graduationYear: number, graduationMonth: number, today: EthDate) {
  return today.year > graduationYear || (today.year === graduationYear && today.month >= graduationMonth);
}

/** Current standing. Year of study goes up every Meskerem; the graduation year shows as GC. */
export function classInfo(m: ClassFields, today: EthDate): ClassInfo {
  if (hasGraduated(m.graduationYear, m.graduationMonth, today)) return { kind: "graduate", graduationYear: m.graduationYear };
  const year = (m.studyYear ?? 1) + (today.year - m.registeredYear);
  return { kind: "student", year: Math.max(1, year), gc: today.year === m.graduationYear, graduationYear: m.graduationYear };
}

export function duesFor(info: ClassInfo, dues: Dues) {
  return info.kind === "graduate" ? dues.graduate : dues.student;
}

export type ClassInput =
  | { standing: "graduate"; department: AcademicDepartment; graduationYear: number | null; graduationMonth: number }
  | { standing: "student"; department: AcademicDepartment; studyYear: number | null; graduationMonth: number };

export type ResolvedClass = { graduationYear: number; graduationMonth: number; studyYear: number | null };

/**
 * Registration: graduates give the year and month they graduated; students give their
 * current year and expected graduation month, and the graduation year is worked out from
 * the programme length (CS/IT 4 years, EE 5).
 */
export function resolveClass(input: ClassInput, today: EthDate): { ok: true; value: ResolvedClass } | { ok: false; field: "graduationYear" | "studyYear" } {
  if (input.standing === "graduate") {
    const y = input.graduationYear;
    if (y === null || !Number.isInteger(y) || y < today.year - 40 || !hasGraduated(y, input.graduationMonth, today)) {
      return { ok: false, field: "graduationYear" };
    }
    return { ok: true, value: { graduationYear: y, graduationMonth: input.graduationMonth, studyYear: null } };
  }
  const years = PROGRAM_YEARS[input.department];
  const s = input.studyYear;
  if (s === null || !Number.isInteger(s) || s < 1 || s > years) return { ok: false, field: "studyYear" };
  const graduationYear = today.year + (years - s);
  // e.g. a final-year student choosing Tir after Tir has passed: they are already a graduate
  if (hasGraduated(graduationYear, input.graduationMonth, today)) return { ok: false, field: "studyYear" };
  return { ok: true, value: { graduationYear, graduationMonth: input.graduationMonth, studyYear: s } };
}
