import { describe, expect, it } from "vitest";
import { checkClassFields, classInfo, duesFor, hasGraduated } from "../app/lib/classyear";

const dues = { student: 30, graduate: 100 };

describe("classInfo", () => {
  const m = { graduationYear: 2020, studyYear: 2, registeredYear: 2018 };
  it("counts up every Meskerem", () => {
    expect(classInfo(m, { year: 2018, month: 3, day: 1 })).toMatchObject({ kind: "student", year: 2, gc: false });
    expect(classInfo(m, { year: 2019, month: 1, day: 1 })).toMatchObject({ kind: "student", year: 3, gc: false });
  });
  it("labels the graduation year GC, then graduate from Hamle", () => {
    expect(classInfo(m, { year: 2020, month: 10, day: 30 })).toMatchObject({ kind: "student", year: 4, gc: true });
    expect(classInfo(m, { year: 2020, month: 11, day: 1 })).toEqual({ kind: "graduate", graduationYear: 2020 });
    expect(classInfo(m, { year: 2023, month: 1, day: 1 })).toEqual({ kind: "graduate", graduationYear: 2020 });
  });
  it("dues follow the standing", () => {
    expect(duesFor(classInfo(m, { year: 2019, month: 1, day: 1 }), dues)).toBe(30);
    expect(duesFor(classInfo(m, { year: 2021, month: 1, day: 1 }), dues)).toBe(100);
  });
  it("graduation happens from Hamle of that year", () => {
    expect(hasGraduated(2019, { year: 2019, month: 10, day: 30 })).toBe(false);
    expect(hasGraduated(2019, { year: 2019, month: 11, day: 1 })).toBe(true);
  });
});

describe("checkClassFields", () => {
  const today = { year: 2019, month: 2, day: 30 };
  it("graduates don't need a study year", () => {
    expect(checkClassFields(2015, null, today)).toBeNull();
  });
  it("students must give a consistent study year", () => {
    expect(checkClassFields(2021, null, today)).toBe("studyYear");
    expect(checkClassFields(2021, 2, today)).toBeNull();
    expect(checkClassFields(2019, 4, today)).toBeNull(); // GC
    expect(checkClassFields(2026, 1, today)).toBe("studyYear"); // 8 years away
  });
  it("rejects implausible graduation years", () => {
    expect(checkClassFields(1900, null, today)).toBe("classYear");
    expect(checkClassFields(2040, 1, today)).toBe("classYear");
  });
});
