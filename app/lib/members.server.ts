import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import type { Lang } from "./lang";
import { studentIdKey } from "./registration";

export type NewMember = {
  fullName: string;
  christianName: string | null;
  gender: "male" | "female";
  phone: string;
  studentId: string;
  department: "cs" | "it" | "ee";
  lang: Lang;
  graduationYear: number;
  graduationMonth: number;
  studyYear: number | null;
  interests: string[];
};

export type CreateMemberError = "studentIdTaken" | "alreadyMember";

/** Used by the website form and the bot. The unique index on student_id is the final guard. */
export async function createMember(db: Db, userId: string, m: NewMember, registeredYear: number): Promise<CreateMemberError | null> {
  if (await db.query.members.findFirst({ where: eq(schema.members.userId, userId), columns: { id: true } })) return "alreadyMember";
  const key = studentIdKey(m.studentId);
  if (await db.query.members.findFirst({ where: eq(schema.members.studentIdKey, key), columns: { id: true } })) return "studentIdTaken";
  try {
    await db.insert(schema.members).values({ ...m, studentIdKey: key, registeredYear, userId });
  } catch {
    return "studentIdTaken";
  }
  return null;
}

export async function memberForUser(db: Db, userId: string) {
  return db.query.members.findFirst({ where: eq(schema.members.userId, userId), columns: { id: true, lang: true, status: true } });
}
