import { describe, expect, it } from "vitest";
import { registrationSchema, reviewMemberTransition } from "../app/lib/registration";
import { safeRedirect } from "../app/lib/session.server";

const valid = {
  fullName: "Abebe Kebede",
  christianName: "",
  gender: "male",
  phone: "0911 234 567",
  studentId: " ugr/12345/12 ",
  department: "cs",
  standing: "student",
  graduationMonth: "9",
  graduationYear: "",
  studyYear: "2",
  lang: "om",
};

describe("registrationSchema", () => {
  it("normalises phone, year and empty optionals", () => {
    const r = registrationSchema.parse(valid);
    expect(r.phone).toBe("+251911234567");
    expect(r.christianName).toBeNull();
    expect(r.graduationYear).toBeNull();
    expect(r.studyYear).toBe(2);
    expect(r.graduationMonth).toBe(9);
    expect(r.studentId).toBe("UGR/12345/12");
    expect(registrationSchema.parse({ ...valid, studyYear: "", standing: "graduate", graduationYear: "2015" }).graduationYear).toBe(2015);
  });

  it.each(["", "ab", "<script>", "a".repeat(31)])("rejects student ID %s", (studentId) => {
    expect(registrationSchema.safeParse({ ...valid, studentId }).success).toBe(false);
  });

  it("only offers Tir and Ginbot as graduation months", () => {
    expect(registrationSchema.safeParse({ ...valid, graduationMonth: "11" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, standing: "alumni" }).success).toBe(false);
  });

  it.each(["0811234567", "091123456", ""])("rejects phone %s", (phone) => {
    expect(registrationSchema.safeParse({ ...valid, phone }).success).toBe(false);
  });

  it("rejects bad enums and years", () => {
    expect(registrationSchema.safeParse({ ...valid, department: "civil" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, graduationYear: "abc" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, lang: "en" }).success).toBe(false);
  });
});

describe("reviewMemberTransition", () => {
  it("reviews pending only", () => {
    expect(reviewMemberTransition("pending", "approve")).toBe("active");
    expect(reviewMemberTransition("pending", "reject")).toBe("rejected");
    expect(reviewMemberTransition("active", "reject")).toBeNull();
  });
});

describe("safeRedirect", () => {
  it("blocks open redirects", () => {
    expect(safeRedirect("/me")).toBe("/me");
    expect(safeRedirect("//evil.com")).toBe("/");
    expect(safeRedirect("https://evil.com")).toBe("/");
  });
});
