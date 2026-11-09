import { z } from "zod";
import { RECEIPT_MAX_BYTES } from "../config";
import { addMonths, monthKey, type EthMonth } from "./ethiopian";

export const RECEIPT_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

/** Months a member may pay for: 6 back (arrears) to 3 ahead (prepay). */
export function payableMonths(current: EthMonth, back = 6, ahead = 3): EthMonth[] {
  const out: EthMonth[] = [];
  for (let i = -back; i <= ahead; i++) out.push(addMonths(current, i));
  return out;
}

const monthValue = z
  .string()
  .regex(/^\d{4}-(?:[1-9]|1[0-2])$/, "months")
  .transform((v) => {
    const [y, m] = v.split("-").map(Number);
    return { year: y, month: m } as EthMonth;
  });

export const contributionSchema = z.object({
  months: z.array(monthValue).min(1, "months").max(12, "months"),
  amount: z.coerce.number().int("amount").min(1, "amount").max(100_000, "amount"),
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((s) => (s ? s : null)),
});

export type ContributionInput = z.infer<typeof contributionSchema>;

/** Validates months against the allowed window and removes duplicates. */
export function checkMonths(months: EthMonth[], allowed: EthMonth[]) {
  const allowedKeys = new Set(allowed.map(monthKey));
  const unique = [...new Map(months.map((m) => [monthKey(m), m])).values()];
  return unique.every((m) => allowedKeys.has(monthKey(m))) ? unique.sort((a, b) => monthKey(a) - monthKey(b)) : null;
}

export function expectedAmount(rate: number, monthCount: number) {
  return rate * monthCount;
}

export function checkReceipt(file: unknown): { ok: true; file: File } | { ok: false; error: "receiptMissing" | "receiptType" | "receiptSize" } {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "receiptMissing" };
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "receiptType" };
  if (file.size > RECEIPT_MAX_BYTES) return { ok: false, error: "receiptSize" };
  return { ok: true, file };
}

export function reviewContributionTransition(current: string, decision: "approve" | "reject") {
  if (current !== "pending") return null;
  return decision === "approve" ? ("approved" as const) : ("rejected" as const);
}
