import { GRADUATION_MONTH, type Dues } from "../config";
import type { EthDate } from "./ethiopian";

export type ClassFields = {
  graduationYear: number; // Ethiopian year
  studyYear: number | null; // year of study when they registered (null if already graduated)
  registeredYear: number; // Ethiopian year they registered
};

export type ClassInfo =
  | { kind: "graduate"; graduationYear: number }
  | { kind: "student"; year: number; gc: boolean; graduationYear: number };

export function hasGraduated(graduationYear: number, today: EthDate) {
  return today.year > graduationYear || (today.year === graduationYear && today.month >= GRADUATION_MONTH);
}

/** Current standing. Year of study goes up every Meskerem; the graduation year shows as GC. */
export function classInfo(m: ClassFields, today: EthDate): ClassInfo {
  if (hasGraduated(m.graduationYear, today)) return { kind: "graduate", graduationYear: m.graduationYear };
  const year = (m.studyYear ?? 1) + (today.year - m.registeredYear);
  return { kind: "student", year: Math.max(1, year), gc: today.year === m.graduationYear, graduationYear: m.graduationYear };
}

export function duesFor(info: ClassInfo, dues: Dues) {
  return info.kind === "graduate" ? dues.graduate : dues.student;
}

/** Registration check: graduation year must be plausible; students must give their current year. */
export function checkClassFields(graduationYear: number, studyYear: number | null, today: EthDate): "classYear" | "studyYear" | null {
  if (graduationYear < today.year - 40 || graduationYear > today.year + 7) return "classYear";
  if (hasGraduated(graduationYear, today)) return null;
  if (studyYear === null || studyYear < 1 || studyYear > 7) return "studyYear";
  // Year of study in the graduation year can't pass 7 (longest programmes)
  if (studyYear + (graduationYear - today.year) > 7) return "studyYear";
  return null;
}
