/**
 * Registration inside the bot, one question at a time. Pure: the webhook stores the
 * state (bot_registrations) and sends the reply. Tested in tests/bot-register.test.ts.
 * Passwords are never asked here (they would stay in the chat history); members set
 * one in the mini app.
 */
import { GRADUATION_MONTHS, PROGRAM_YEARS, type AcademicDepartment } from "../config";
import { resolveClass } from "./classyear";
import type { EthDate } from "./ethiopian";
import { DICTS, t } from "./i18n";
import type { Lang } from "./lang";
import { ethiopianPhone, registrationSchema, studentIdSchema } from "./registration";

export const REG_STEPS = [
  "lang",
  "fullName",
  "christianName",
  "gender",
  "phone",
  "studentId",
  "department",
  "standing",
  "studyYear",
  "graduationYear",
  "graduationMonth",
  "confirm",
] as const;
export type RegStep = (typeof REG_STEPS)[number];
export type RegState = { step: RegStep; data: Record<string, string> };

export type RegInput = { kind: "text"; text: string } | { kind: "choice"; value: string } | { kind: "contact"; phone: string };

export type RegReply = {
  text: string;
  /** Inline buttons: rows of [callback value, label] */
  choices?: [string, string][][];
  /** Show Telegram's "share my phone number" keyboard */
  askContact?: boolean;
  /** Remove the phone keyboard once it isn't needed */
  removeKeyboard?: boolean;
};

export type RegResult =
  | { state: RegState; reply: RegReply; checkStudentId?: string }
  | { state: null; reply: RegReply; submit: RegistrationData };

export type RegistrationData = {
  fullName: string;
  christianName: string | null;
  gender: "male" | "female";
  phone: string;
  studentId: string;
  department: AcademicDepartment;
  lang: Lang;
  graduationYear: number;
  graduationMonth: number;
  studyYear: number | null;
};

export const START: RegState = { step: "lang", data: {} };

const langOf = (s: RegState): Lang => (s.data.lang === "am" ? "am" : "om");

/** The question (and buttons) for a step. */
export function prompt(state: RegState, error?: string): RegReply {
  const lang = langOf(state);
  const tr = t(lang);
  const r = tr.register;
  const b = tr.botReg;
  const d = state.data;
  const q = (text: string) => (error ? `⚠️ ${error}\n\n${text}` : text);
  switch (state.step) {
    case "lang":
      return { text: q(`${DICTS.om.botReg.chooseLang}\n${DICTS.am.botReg.chooseLang}`), choices: [[["om", "Afaan Oromoo"], ["am", "አማርኛ"]]] };
    case "fullName":
      return { text: q(`${b.step(1)} ${r.fullName}?`) };
    case "christianName":
      return { text: q(`${b.step(2)} ${r.christianName}? (${tr.optional})`), choices: [[["skip", b.skip]]] };
    case "gender":
      return { text: q(`${b.step(3)} ${r.gender}?`), choices: [[["male", r.male], ["female", r.female]]] };
    case "phone":
      return { text: q(`${b.step(4)} ${r.phone}? ${b.phoneHint}`), askContact: true };
    case "studentId":
      return { text: q(`${b.step(5)} ${r.studentId}? (${r.studentIdHint})`), removeKeyboard: true };
    case "department":
      return { text: q(`${b.step(6)} ${r.department}?`), choices: (["cs", "it", "ee"] as const).map((x) => [[x, tr.dept[x]]]) };
    case "standing":
      return { text: q(`${b.step(7)} ${r.standing}?`), choices: [[["student", r.standingStudent], ["graduate", r.standingGraduate]]] };
    case "studyYear": {
      const years = PROGRAM_YEARS[(d.department as AcademicDepartment) ?? "ee"] ?? 5;
      const row = Array.from({ length: years }, (_, i) => [String(i + 1), tr.standing.year(i + 1)] as [string, string]);
      return { text: q(`${b.step(8)} ${r.studyYear}?`), choices: [row.slice(0, 3), row.slice(3)].filter((x) => x.length) };
    }
    case "graduationYear":
      return { text: q(`${b.step(8)} ${r.graduationYear}? (${r.graduationHint})`) };
    case "graduationMonth":
      return {
        text: q(`${b.step(9)} ${d.standing === "student" ? r.graduationMonthExpected : r.graduationMonth}?`),
        choices: [GRADUATION_MONTHS.map((m) => [String(m), tr.months[m - 1]] as [string, string])],
      };
    case "confirm":
      return { text: q(summary(state)), choices: [[["submit", b.submit]], [["restart", b.restart]]] };
  }
}

function summary(state: RegState) {
  const tr = t(langOf(state));
  const r = tr.register;
  const d = state.data;
  const lines = [
    tr.botReg.check,
    "",
    `${r.fullName}: ${d.fullName}`,
    ...(d.christianName ? [`${r.christianName}: ${d.christianName}`] : []),
    `${r.gender}: ${d.gender === "female" ? r.female : r.male}`,
    `${r.phone}: ${d.phone}`,
    `${r.studentId}: ${d.studentId}`,
    `${r.department}: ${tr.dept[d.department as AcademicDepartment]}`,
    d.standing === "student" ? `${r.studyYear}: ${tr.standing.year(Number(d.studyYear))}` : `${r.graduationYear}: ${d.graduationYear}`,
    `${d.standing === "student" ? r.graduationMonthExpected : r.graduationMonth}: ${tr.months[Number(d.graduationMonth) - 1]}`,
  ];
  return lines.join("\n");
}

const go = (state: RegState, step: RegStep, data: Record<string, string> = {}): { state: RegState; reply: RegReply } => {
  const next: RegState = { step, data: { ...state.data, ...data } };
  return { state: next, reply: prompt(next) };
};

/** Applies one answer and returns the next question, an error for the same question, or the finished registration. */
export function regNext(state: RegState, input: RegInput, today: EthDate): RegResult {
  const tr = t(langOf(state));
  const err = tr.errors;
  const again = (msg: string): RegResult => ({ state, reply: prompt(state, msg) });
  const text = input.kind === "text" ? input.text.trim() : "";
  const choice = input.kind === "choice" ? input.value : "";
  const pick = (allowed: readonly string[]) => (allowed.includes(choice) ? choice : null);
  const shape = registrationSchema.shape;

  switch (state.step) {
    case "lang": {
      const v = pick(["om", "am"]);
      return v ? go(state, "fullName", { lang: v }) : again(DICTS.om.botReg.useButtons);
    }
    case "fullName": {
      const p = shape.fullName.safeParse(text);
      return p.success ? go(state, "christianName", { fullName: p.data }) : again(err.fullName);
    }
    case "christianName": {
      if (choice === "skip") return go(state, "gender", { christianName: "" });
      if (!text || text.length > 60) return again(tr.botReg.useButtons);
      return go(state, "gender", { christianName: text });
    }
    case "gender": {
      const v = pick(["male", "female"]);
      return v ? go(state, "phone", { gender: v }) : again(tr.botReg.useButtons);
    }
    case "phone": {
      const raw = input.kind === "contact" ? input.phone : text;
      const p = ethiopianPhone.safeParse(raw);
      return p.success ? go(state, "studentId", { phone: p.data }) : again(err.phone);
    }
    case "studentId": {
      const p = studentIdSchema.safeParse(text);
      if (!p.success) return again(err.studentId);
      // The webhook checks the ID isn't registered yet before moving on
      return { ...go(state, "department", { studentId: p.data }), checkStudentId: p.data };
    }
    case "department": {
      const v = pick(["cs", "it", "ee"]);
      return v ? go(state, "standing", { department: v }) : again(tr.botReg.useButtons);
    }
    case "standing": {
      const v = pick(["student", "graduate"]);
      if (!v) return again(tr.botReg.useButtons);
      return go(state, v === "student" ? "studyYear" : "graduationYear", { standing: v, studyYear: "", graduationYear: "" });
    }
    case "studyYear": {
      const max = PROGRAM_YEARS[state.data.department as AcademicDepartment] ?? 5;
      const n = Number(choice);
      return Number.isInteger(n) && n >= 1 && n <= max ? go(state, "graduationMonth", { studyYear: String(n) }) : again(tr.botReg.useButtons);
    }
    case "graduationYear": {
      const n = Number(text);
      return Number.isInteger(n) && n > 1900 && n < 2200 ? go(state, "graduationMonth", { graduationYear: String(n) }) : again(err.classYear);
    }
    case "graduationMonth": {
      const v = pick(GRADUATION_MONTHS.map(String));
      if (!v) return again(tr.botReg.useButtons);
      const d: Record<string, string> = { ...state.data, graduationMonth: v };
      const resolved = resolveClass(
        d.standing === "graduate"
          ? { standing: "graduate", department: d.department as AcademicDepartment, graduationYear: Number(d.graduationYear), graduationMonth: Number(v) }
          : { standing: "student", department: d.department as AcademicDepartment, studyYear: Number(d.studyYear), graduationMonth: Number(v) },
        today,
      );
      if (!resolved.ok) {
        // Back to the year question, with the reason
        const back: RegState = { step: d.standing === "graduate" ? "graduationYear" : "studyYear", data: d };
        return { state: back, reply: prompt(back, resolved.field === "graduationYear" ? err.classYear : err.studyYear) };
      }
      return go(state, "confirm", { graduationMonth: v });
    }
    case "confirm": {
      if (choice === "restart") return go({ step: "fullName", data: { lang: state.data.lang } }, "fullName");
      if (choice !== "submit") return again(tr.botReg.useButtons);
      const d = state.data;
      const resolved = resolveClass(
        d.standing === "graduate"
          ? { standing: "graduate", department: d.department as AcademicDepartment, graduationYear: Number(d.graduationYear), graduationMonth: Number(d.graduationMonth) }
          : { standing: "student", department: d.department as AcademicDepartment, studyYear: Number(d.studyYear), graduationMonth: Number(d.graduationMonth) },
        today,
      );
      if (!resolved.ok) return go(state, "standing");
      return {
        state: null,
        reply: { text: tr.botReg.done, removeKeyboard: true },
        submit: {
          fullName: d.fullName,
          christianName: d.christianName || null,
          gender: d.gender === "female" ? "female" : "male",
          phone: d.phone,
          studentId: d.studentId,
          department: d.department as AcademicDepartment,
          lang: langOf(state),
          ...resolved.value,
        },
      };
    }
  }
}
