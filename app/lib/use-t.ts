import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "../root";
import { DEFAULT_LANG } from "./lang";
import { t } from "./i18n";

/** Current language + dictionary, from the root loader. */
export function useT() {
  const lang = useRouteLoaderData<typeof rootLoader>("root")?.lang ?? DEFAULT_LANG;
  return { lang, tr: t(lang) };
}
