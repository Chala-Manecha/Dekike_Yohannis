export const LANGS = ["om", "am"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "om";
export const LANG_COOKIE = "lang";

export const LANG_LABELS: Record<Lang, string> = { om: "Afaan Oromoo", am: "አማርኛ" };

export function parseLang(value: unknown): Lang {
  return LANGS.includes(value as Lang) ? (value as Lang) : DEFAULT_LANG;
}

export function langFromCookie(cookieHeader: string | null): Lang {
  const match = cookieHeader?.match(/(?:^|;\s*)lang=([a-z]{2})/);
  return parseLang(match?.[1]);
}
