import { z } from "zod";
import { ethToIso, isoToEth } from "./dates";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));

export const eventFormSchema = z.object({
  type: z.enum(["zikr", "welcome", "farewell", "other"]),
  title: optional(120),
  description: optional(1000),
  time: optional(40),
  place: optional(120),
  ethDay: z.coerce.number().int(),
  ethMonth: z.coerce.number().int(),
  ethYear: z.coerce.number().int(),
});

/** Ethiopian date fields → ISO date, or null if the date doesn't exist (e.g. Pagume 7). */
export function ethFieldsToIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 13 || day < 1 || day > 30 || year < 2000 || year > 2100) return null;
  const iso = ethToIso({ year, month, day });
  const back = isoToEth(iso);
  return back.year === year && back.month === month && back.day === day ? iso : null;
}
