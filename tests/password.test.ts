import { describe, expect, it } from "vitest";
import { hashPassword, passwordSchema, verifyPassword } from "../app/lib/password";

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const h = await hashPassword("zikr-2019!");
    expect(h).toMatch(/^pbkdf2-sha256\$20000\$/);
    expect(await verifyPassword("zikr-2019!", h)).toBe(true);
    expect(await verifyPassword("zikr-2019", h)).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same-password")).not.toBe(await hashPassword("same-password"));
  });
  it("keeps working when the round count changes", async () => {
    const old = await hashPassword("pass-word-1", 5000);
    expect(await verifyPassword("pass-word-1", old)).toBe(true);
  });
  it("rejects broken or missing hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "plain")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$abc$AA==$AA==")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$20000$!!$AA==")).toBe(false);
  });
  it("needs at least 8 characters", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });
});

import { afterFailure, isLocked, MAX_FAILURES, WINDOW_MS } from "../app/lib/login-limit";

describe("login lockout", () => {
  it("locks after 5 failures and unlocks after 15 minutes", () => {
    let a: { failures: number; windowStart: number } | null = null;
    for (let i = 0; i < MAX_FAILURES; i++) a = afterFailure(a, 1000 + i);
    expect(isLocked(a, 2000)).toBe(true);
    expect(isLocked(a, 1000 + WINDOW_MS)).toBe(false);
    expect(afterFailure(a, 1000 + WINDOW_MS)).toEqual({ failures: 1, windowStart: 1000 + WINDOW_MS });
    expect(isLocked(null, 0)).toBe(false);
  });
});
