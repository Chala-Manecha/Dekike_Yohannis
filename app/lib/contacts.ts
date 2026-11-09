/** Public contact people (homepage), kept by the members department. Tested in tests/contacts.test.ts. */
import { z } from "zod";
import { ethiopianPhone } from "./registration";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => s || null);

export const contactSchema = z
  .object({
    name: z.string().trim().min(2, "fullName").max(80, "fullName"),
    role: optional(60),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((s) => s || null)
      .pipe(z.union([z.null(), ethiopianPhone])),
    telegram: z
      .string()
      .trim()
      .optional()
      .transform((s) => (s ? s.replace(/^@|^https?:\/\/t\.me\//, "") : null))
      .refine((s) => s === null || /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s), "telegram"),
    sort: z.coerce.number().int().min(0).max(999).catch(0),
  })
  .refine((c) => c.phone || c.telegram, { message: "contactWay", path: ["phone"] });
