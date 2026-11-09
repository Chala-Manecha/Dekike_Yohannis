import { eq } from "drizzle-orm";
import { DEFAULT_DUES, type Dues } from "../config";
import type { Db } from "../db";
import { schema } from "../db";

export async function getDues(db: Db): Promise<Dues> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "dues") });
  const v = row?.value as Partial<Dues> | undefined;
  return {
    student: Number.isInteger(v?.student) ? v!.student! : DEFAULT_DUES.student,
    graduate: Number.isInteger(v?.graduate) ? v!.graduate! : DEFAULT_DUES.graduate,
  };
}

export async function setSetting(db: Db, key: string, value: unknown, userId: string | null) {
  await db
    .insert(schema.settings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

export async function getSetting<T>(db: Db, key: string): Promise<T | null> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return (row?.value as T) ?? null;
}
