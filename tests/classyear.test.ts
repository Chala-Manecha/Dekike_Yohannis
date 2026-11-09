import { describe, expect, it } from "vitest";
import { classInfo, duesFor, hasGraduated, resolveClass } from "../app/lib/classyear";

const dues = { student: 30, graduate: 100 };
const TIR = 5;
const GINBOT = 9;

describe("classInfo", () => {
  const m = { graduationYear: 2020, graduationMonth: GINBOT, studyYear: 2, registeredYear: 2018 };
  it("counts up every Meskerem", () => {
    expect(classInfo(m, { year: 2018, month: 3, day: 1 })).toMatchObject({ kind: "student", year: 2, gc: false });
    expect(classInfo(m, { year: 2019, month: 1, day: 1 })).toMatchObject({ kind: "student", year: 3, gc: false });
  });
  it("labels the graduation year GC, then graduate from their graduation month", () => {
    expect(classInfo(m, { year: 2020, month: 8, day: 30 })).toMatchObject({ kind: "student", year: 4, gc: true });
    expect(classInfo(m, { year: 2020, month: 9, day: 1 })).toEqual({ kind: "graduate", graduationYear: 2020 });
    expect(classInfo({ ...m, graduationMonth: TIR }, { year: 2020, month: 5, day: 1 })).toEqual({ kind: "graduate", graduationYear: 2020 });
  });
  it("dues follow the standing", () => {
    expect(duesFor(classInfo(m, { year: 2019, month: 1, day: 1 }), dues)).toBe(30);
    expect(duesFor(classInfo(m, { year: 2021, month: 1, day: 1 }), dues)).toBe(100);
  });
  it("graduation happens from the chosen month", () => {
    expect(hasGraduated(2019, GINBOT, { year: 2019, month: 8, day: 30 })).toBe(false);
    expect(hasGraduated(2019, GINBOT, { year: 2019, month: 9, day: 1 })).toBe(true);
    expect(hasGraduated(2019, TIR, { year: 2019, month: 5, day: 1 })).toBe(true);
  });
});

describe("resolveClass", () => {
  const today = { year: 2019, month: 3, day: 1 }; // Hidar 2019
  it("works out a student's graduation year from the programme length", () => {
    expect(resolveClass({ standing: "student", department: "cs", studyYear: 2, graduationMonth: GINBOT }, today))
      .toEqual({ ok: true, value: { graduationYear: 2021, graduationMonth: GINBOT, studyYear: 2 } });
    expect(resolveClass({ standing: "student", department: "ee", studyYear: 2, graduationMonth: TIR }, today))
      .toEqual({ ok: true, value: { graduationYear: 2022, graduationMonth: TIR, studyYear: 2 } });
    // final year: graduates this year (GC)
    expect(resolveClass({ standing: "student", department: "it", studyYear: 4, graduationMonth: TIR }, today))
      .toMatchObject({ ok: true, value: { graduationYear: 2019 } });
  });
  it("limits the year to the programme: 4 for CS/IT, 5 for EE", () => {
    expect(resolveClass({ standing: "student", department: "cs", studyYear: 5, graduationMonth: GINBOT }, today)).toEqual({ ok: false, field: "studyYear" });
    expect(resolveClass({ standing: "student", department: "ee", studyYear: 5, graduationMonth: GINBOT }, today).ok).toBe(true);
    expect(resolveClass({ standing: "student", department: "cs", studyYear: null, graduationMonth: GINBOT }, today)).toEqual({ ok: false, field: "studyYear" });
  });
  it("a final-year student whose graduation month has passed must register as a graduate", () => {
    const afterTir = { year: 2019, month: 6, day: 1 };
    expect(resolveClass({ standing: "student", department: "cs", studyYear: 4, graduationMonth: TIR }, afterTir)).toEqual({ ok: false, field: "studyYear" });
    expect(resolveClass({ standing: "student", department: "cs", studyYear: 4, graduationMonth: GINBOT }, afterTir).ok).toBe(true);
  });
  it("graduates give a year and month that have already passed, no study year", () => {
    expect(resolveClass({ standing: "graduate", department: "cs", graduationYear: 2016, graduationMonth: TIR }, today))
      .toEqual({ ok: true, value: { graduationYear: 2016, graduationMonth: TIR, studyYear: null } });
    expect(resolveClass({ standing: "graduate", department: "cs", graduationYear: 2019, graduationMonth: TIR }, today)).toEqual({ ok: false, field: "graduationYear" });
    expect(resolveClass({ standing: "graduate", department: "cs", graduationYear: 1950, graduationMonth: TIR }, today)).toEqual({ ok: false, field: "graduationYear" });
    expect(resolveClass({ standing: "graduate", department: "cs", graduationYear: null, graduationMonth: TIR }, today)).toEqual({ ok: false, field: "graduationYear" });
  });
});
