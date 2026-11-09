/**
 * Website passwords (sign-in with student ID + password).
 * PBKDF2-SHA256 through WebCrypto (native code). 20,000 rounds keeps a sign-in inside the
 * Workers free plan's CPU limit; repeated wrong guesses are locked out (login-limit.server.ts).
 * The round count is stored in each hash, so it can be raised later (e.g. on a paid plan)
 * and old hashes keep working. Tested in tests/password.test.ts.
 */
import { z } from "zod";

export const PBKDF2_ROUNDS = 20_000;
const enc = new TextEncoder();

export const passwordSchema = z.string().min(8, "passwordShort").max(128, "passwordShort");

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}

/** "pbkdf2-sha256$<rounds>$<salt>$<hash>" */
export async function hashPassword(password: string, rounds = PBKDF2_ROUNDS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${rounds}$${b64(salt)}$${b64(await derive(password, salt, rounds))}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const parts = stored?.split("$");
  if (!parts || parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const rounds = Number(parts[1]);
  if (!Number.isInteger(rounds) || rounds < 1000 || rounds > 10_000_000) return false;
  let salt: Uint8Array<ArrayBuffer>, expected: Uint8Array;
  try {
    salt = unb64(parts[2]);
    expected = unb64(parts[3]);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, rounds);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
