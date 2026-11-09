import { describe, expect, it } from "vitest";
import { contactSchema } from "../app/lib/contacts";

describe("contactSchema", () => {
  it("normalises phone and Telegram username", () => {
    expect(contactSchema.parse({ name: "Abebe", role: "Leader", phone: "0911 223 344", telegram: "@abebe_k", sort: "1" })).toEqual({
      name: "Abebe", role: "Leader", phone: "+251911223344", telegram: "abebe_k", sort: 1,
    });
    expect(contactSchema.parse({ name: "Hana", telegram: "https://t.me/hana_t" }).telegram).toBe("hana_t");
  });
  it("needs a phone or a Telegram username", () => {
    expect(contactSchema.safeParse({ name: "Abebe", phone: "", telegram: "" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "Abebe", phone: "0911223344" }).success).toBe(true);
  });
  it("rejects bad values", () => {
    expect(contactSchema.safeParse({ name: "Abebe", phone: "12345" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "Abebe", telegram: "a b" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "A", phone: "0911223344" }).success).toBe(false);
  });
});
