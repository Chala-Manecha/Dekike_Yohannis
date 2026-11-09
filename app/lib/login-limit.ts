/** Wrong-password lockout: 5 failures within 15 minutes locks that student ID for 15 minutes. */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export type Attempts = { failures: number; windowStart: number } | null | undefined;

export function isLocked(a: Attempts, now: number) {
  return Boolean(a && a.failures >= MAX_FAILURES && now - a.windowStart < WINDOW_MS);
}

/** Next counter after a failure: a new window starts once the old one is over. */
export function afterFailure(a: Attempts, now: number) {
  if (!a || now - a.windowStart >= WINDOW_MS) return { failures: 1, windowStart: now };
  return { failures: a.failures + 1, windowStart: a.windowStart };
}
