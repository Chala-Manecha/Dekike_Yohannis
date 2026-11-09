import { z } from "zod";

// Accepts 09XXXXXXXX, 07XXXXXXXX (Safaricom) or +251 forms; stores +251 form.
export const ethiopianPhone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .refine((s) => /^(\+251|251|0)[79]\d{8}$/.test(s), "phone")
  .transform((s) => "+251" + s.replace(/^(\+251|251|0)/, ""));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));

const optionalInt = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? Number(s) : null))
    .refine((n) => n === null || Number.isInteger(n), message);

/** University ID as printed on the card, e.g. "UGR/12345/12". Stored upper-case, single spaces. */
export const studentIdSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase().replace(/\s+/g, " "))
  .refine((s) => /^[A-Z0-9][A-Z0-9/\-_. ]{2,29}$/.test(s), "studentId");

/** Error messages are i18n keys (see app/lib/i18n.ts → errors). Standing is checked by resolveClass(). */
export const registrationSchema = z.object({
  fullName: z.string().trim().min(3, "fullName").max(80, "fullName"),
  christianName: optionalText(60),
  gender: z.enum(["male", "female"], { message: "choose" }),
  phone: ethiopianPhone,
  studentId: studentIdSchema,
  department: z.enum(["cs", "it", "ee"], { message: "choose" }),
  standing: z.enum(["student", "graduate"], { message: "choose" }),
  graduationMonth: z.enum(["5", "9"], { message: "choose" }).transform(Number),
  graduationYear: optionalInt("classYear"),
  studyYear: optionalInt("studyYear"),
  lang: z.enum(["om", "am"], { message: "choose" }),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export type ReviewDecision = "approve" | "reject";

/** Only pending items can be reviewed. */
export function reviewMemberTransition(current: string, decision: ReviewDecision) {
  if (current !== "pending") return null;
  return decision === "approve" ? ("active" as const) : ("rejected" as const);
}
