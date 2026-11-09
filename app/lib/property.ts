/** Property (qabeenya / ንብረት): the group's items. Pure, tested in tests/property.test.ts. */
import { z } from "zod";

export const CONDITIONS = ["good", "worn", "broken"] as const;
export type Condition = (typeof CONDITIONS)[number];

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => s || null);

export const itemSchema = z.object({
  name: z.string().trim().min(2, "itemName").max(100, "itemName"),
  quantity: z.coerce.number({ message: "quantity" }).int("quantity").min(0, "quantity").max(100_000, "quantity"),
  condition: z.enum(CONDITIONS, { message: "choose" }),
  location: optional(120),
  note: optional(300),
});

export type ItemCounts = Record<Condition, number>;

/** How many items (not rows) are in each condition. */
export function countByCondition(items: { quantity: number; condition: Condition }[]): ItemCounts {
  const out: ItemCounts = { good: 0, worn: 0, broken: 0 };
  for (const i of items) out[i.condition] += i.quantity;
  return out;
}
