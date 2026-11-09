/** Fails closed: any network or parse problem counts as "not verified". */
export async function verifyTurnstile(token: FormDataEntryValue | null, secret: string, ip?: string | null) {
  if (typeof token !== "string" || !token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
