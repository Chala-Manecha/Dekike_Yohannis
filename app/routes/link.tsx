import { useEffect, useState } from "react";
import { redirect } from "react-router";
import type { Route } from "./+types/link";
import { signInWithTelegram, telegramInitData } from "../components/TelegramMiniApp";
import { getUser } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getUser(request, context.cloudflare.env)) throw redirect("/me");
  return null;
}

/**
 * Mini app, first visit with a Telegram account that isn't tied to a member yet:
 * either sign in once with student ID + password (links this Telegram account for good),
 * or register as a new member.
 */
export default function Link() {
  const { tr } = useT();
  const k = tr.link;
  const [initData, setInitData] = useState<string | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  useEffect(() => setInitData(telegramInitData()), []);

  if (!initData) {
    return (
      <section className="page narrow">
        <h1>{k.title}</h1>
        <p>{k.onlyInTelegram}</p>
      </section>
    );
  }

  async function onLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ busy: true });
    const res = await fetch("/api/auth/telegram-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, studentId: f.get("studentId"), password: f.get("password") }),
    }).catch(() => null);
    if (res?.ok) return window.location.assign("/me");
    const body = (await res?.json().catch(() => null)) as { message?: string } | null;
    const msg =
      res?.status === 429 ? tr.login.locked
      : body?.message === "telegram_taken" ? k.telegramTaken
      : body?.message === "account_has_telegram" ? k.accountHasTelegram
      : tr.login.badCredentials;
    setState({ busy: false, error: msg });
  }

  async function onRegister() {
    setState({ busy: true });
    const r = await signInWithTelegram(initData!, true);
    if (r === "ok") window.location.assign("/register");
    else setState({ busy: false, error: tr.login.failed });
  }

  return (
    <section className="page narrow">
      <h1>{k.title}</h1>
      <p>{k.intro}</p>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}

      <div className="panel">
        <h2>{k.haveAccount}</h2>
        <form className="form" onSubmit={onLink}>
          <label className="field">
            <span>{tr.login.studentId}</span>
            <input name="studentId" required autoCapitalize="characters" autoComplete="username" />
          </label>
          <label className="field">
            <span>{tr.login.password}</span>
            <input name="password" type="password" required minLength={8} autoComplete="current-password" />
          </label>
          <button className="btn btn-primary" disabled={state.busy}>{k.linkButton}</button>
        </form>
      </div>

      <div className="panel link-new">
        <h2>{k.newMember}</h2>
        <p className="muted">{k.newHint}</p>
        <button type="button" className="btn btn-quiet" disabled={state.busy} onClick={onRegister}>{k.registerButton}</button>
      </div>
    </section>
  );
}
