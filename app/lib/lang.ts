export const LANGS = ["om", "am"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "om";
export const LANG_COOKIE = "lang";

export const LANG_LABELS: Record<Lang, string> = { om: "Afaan Oromoo", am: "አማርኛ" };

export function parseLang(value: unknown): Lang {
  return LANGS.includes(value as Lang) ? (value as Lang) : DEFAULT_LANG;
}

/** The language the visitor picked, or null if they haven't picked one yet. */
export function chosenLang(cookieHeader: string | null): Lang | null {
  const value = cookieHeader?.match(/(?:^|;\s*)lang=([a-z]{2})(?:;|$)/)?.[1];
  return LANGS.includes(value as Lang) ? (value as Lang) : null;
}

export function langFromCookie(cookieHeader: string | null): Lang {
  return chosenLang(cookieHeader) ?? DEFAULT_LANG;
}

/** 400 days is the most browsers allow; the root loader renews it on visits, so the choice sticks. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export function langCookie(lang: Lang) {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
}
