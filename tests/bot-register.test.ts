import { describe, expect, it } from "vitest";
import { regNext, START, type RegInput, type RegState } from "../app/lib/bot-register";

const today = { year: 2019, month: 3, day: 1 };
const text = (t: string): RegInput => ({ kind: "text", text: t });
const pick = (v: string): RegInput => ({ kind: "choice", value: v });

function run(inputs: RegInput[]) {
  let state: RegState | null = START;
  let last;
  for (const i of inputs) {
    last = regNext(state!, i, today);
    state = last.state;
  }
  return last!;
}

const student = [pick("om"), text("Abebe Kebede"), pick("skip"), pick("male"), { kind: "contact", phone: "251911234567" } as RegInput, text("ugr/123/12"), pick("cs"), pick("student"), pick("3"), pick("5")];

describe("bot registration", () => {
  it("walks a student through every question to a summary", () => {
    const r = run(student);
    expect(r.state?.step).toBe("confirm");
    expect(r.reply.text).toContain("UGR/123/12");
    expect(r.reply.text).toContain("+251911234567");
  });

  it("submits a finished registration with the worked-out graduation year", () => {
    const r = run([...student, pick("submit")]);
    expect(r.state).toBeNull();
    expect("submit" in r && r.submit).toMatchObject({
      fullName: "Abebe Kebede",
      christianName: null,
      phone: "+251911234567",
      studentId: "UGR/123/12",
      department: "cs",
      lang: "om",
      studyYear: 3,
      graduationYear: 2020,
      graduationMonth: 5,
    });
  });

  it("asks graduates for the year instead of the current year", () => {
    const r = run([pick("am"), text("Hana T"), text("Mariam"), pick("female"), text("0911223344"), text("ugr/9/09"), pick("ee"), pick("graduate"), text("2015"), pick("9"), pick("submit")]);
    expect("submit" in r && r.submit).toMatchObject({ lang: "am", christianName: "Mariam", studyYear: null, graduationYear: 2015, graduationMonth: 9 });
  });

  it("repeats a question with the reason on a bad answer", () => {
    const afterName = run([pick("om"), text("A")]);
    expect(afterName.state?.step).toBe("fullName");
    expect(afterName.reply.text.startsWith("⚠️")).toBe(true);
    const badPhone = run([pick("om"), text("Abebe Kebede"), pick("skip"), pick("male"), text("12345")]);
    expect(badPhone.state?.step).toBe("phone");
  });

  it("only offers years that exist in the programme", () => {
    const atYear = run([pick("om"), text("Abebe Kebede"), pick("skip"), pick("male"), text("0911234567"), text("ugr/1/12"), pick("it"), pick("student")]);
    expect(atYear.reply.choices?.flat().map(([v]) => v)).toEqual(["1", "2", "3", "4"]);
    expect(regNext(atYear.state!, pick("5"), today).state?.step).toBe("studyYear");
  });

  it("asks the webhook to check the student ID", () => {
    const r = run([pick("om"), text("Abebe Kebede"), pick("skip"), pick("male"), text("0911234567"), text(" ugr/55/12 ")]);
    expect("checkStudentId" in r && r.checkStudentId).toBe("UGR/55/12");
  });

  it("sends a graduate whose date hasn't passed back to the year question", () => {
    const r = run([pick("om"), text("Abebe Kebede"), pick("skip"), pick("male"), text("0911234567"), text("ugr/2/12"), pick("cs"), pick("graduate"), text("2020"), pick("9")]);
    expect(r.state?.step).toBe("graduationYear");
    expect(r.reply.text.startsWith("⚠️")).toBe(true);
  });

  it("can start over from the summary, keeping the language", () => {
    const r = run([...student, pick("restart")]);
    expect(r.state).toEqual({ step: "fullName", data: { lang: "om" } });
  });
});
