import { Form, useLocation } from "react-router";
import { DICTS } from "../lib/i18n";
import { LANGS, LANG_LABELS } from "../lib/lang";

/**
 * Shown once, on a visitor's first page load, until they pick a language.
 * A plain form post to /lang, so it works before JavaScript loads.
 */
export function LangChooser() {
  const location = useLocation();
  return (
    <div className="lang-chooser" role="dialog" aria-modal="true" aria-labelledby="lang-chooser-title">
      <Form method="post" action="/lang" className="lang-chooser-card">
        <h2 id="lang-chooser-title">
          {LANGS.map((l) => (
            <span key={l} lang={l}>{DICTS[l].chooseLang}</span>
          ))}
        </h2>
        <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
        <div className="lang-chooser-options">
          {LANGS.map((l) => (
            <button key={l} type="submit" name="lang" value={l} lang={l} className="btn btn-primary">
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </Form>
    </div>
  );
}
