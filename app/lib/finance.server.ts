import { and, eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { classInfo } from "./classyear";
import type { EthDate, EthMonth } from "./ethiopian";

/** Every active member with their dues status for one month (used by Finance pages and the dashboard). */
export async function monthPayRows(db: Db, month: EthMonth, today: EthDate) {
  const [activeMembers, claims] = await Promise.all([
    db
      .select({
        id: schema.members.id,
        fullName: schema.members.fullName,
        studentId: schema.members.studentId,
        department: schema.members.department,
        graduationYear: schema.members.graduationYear,
        graduationMonth: schema.members.graduationMonth,
        studyYear: schema.members.studyYear,
        registeredYear: schema.members.registeredYear,
        phone: schema.members.phone,
        telegramUsername: schema.user.telegramUsername,
      })
      .from(schema.members)
      .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
      .where(eq(schema.members.status, "active")),
    db
      .select({ memberId: schema.contributionMonths.memberId, status: schema.contributions.status, amount: schema.contributions.amount, months: schema.contributions.months })
      .from(schema.contributionMonths)
      .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionMonths.contributionId))
      .where(and(eq(schema.contributionMonths.ethYear, month.year), eq(schema.contributionMonths.ethMonth, month.month))),
  ]);
  const byMember = new Map(claims.map((c) => [c.memberId, c]));
  // A payment covering several months is split evenly across them for the monthly total.
  const collected = Math.round(claims.filter((c) => c.status === "approved").reduce((sum, c) => sum + c.amount / c.months.length, 0));
  const rows = activeMembers.map((m) => {
    const standing = classInfo(m, today);
    const status = (byMember.get(m.id)?.status ?? "unpaid") as "approved" | "pending" | "unpaid";
    return { ...m, standing, kind: standing.kind, status };
  });
  return { rows, collected };
}
