import { Form, useLocation } from "react-router";
import { LANGS, LANG_LABELS, type Lang } from "../lib/lang";

export function LangSwitch({ current }: { current: Lang }) {
  const location = useLocation();
  return (
    <Form method="post" action="/lang" className="lang-switch" aria-label="Language">
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      {LANGS.map((l) => (
        <button
          key={l}
          type="submit"
          name="lang"
          value={l}
          aria-pressed={l === current}
          lang={l}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </Form>
  );
}
