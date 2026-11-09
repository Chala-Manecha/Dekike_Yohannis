import { useEffect, useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { signInWithTelegram, telegramInitData } from "../components/TelegramMiniApp";
import { createAuth } from "../lib/auth.server";
import { getUser, safeRedirect } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const next = safeRedirect(new URL(request.url).searchParams.get("next"), "/dashboard");
  if (await getUser(request, env)) throw redirect(next);
  return { next, botUsername: env.TELEGRAM_BOT_USERNAME, devLogin: import.meta.env.DEV };
}

/** Student ID + password, checked by the auth server (lockout after repeated wrong passwords). */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const next = safeRedirect(form.get("next"), "/dashboard");
  const res = await createAuth(context.cloudflare.env).api.studentLogin({
    body: { studentId: String(form.get("studentId") ?? ""), password: String(form.get("password") ?? "") },
    headers: request.headers,
    asResponse: true,
  });
  if (!res.ok) return { error: res.status === 429 ? ("locked" as const) : ("badCredentials" as const), studentId: String(form.get("studentId") ?? "") };
  const headers = new Headers();
  for (const cookie of res.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return redirect(next, { headers });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const l = tr.login;
  const busy = useNavigation().state !== "idle";
  const { next, botUsername, devLogin } = loaderData;
  const [inTelegram, setInTelegram] = useState<string | null>(null);
  useEffect(() => setInTelegram(telegramInitData()), []);

  return (
    <section className="page narrow">
      <h1>{l.title}</h1>

      {inTelegram && (
        <p>
          <button
            type="button"
            className="btn btn-primary btn-telegram"
            onClick={async () => {
              const r = await signInWithTelegram(inTelegram);
              window.location.assign(r === "unlinked" ? "/link" : r === "ok" ? next : "/login");
            }}
          >
            {l.continueTelegram}
          </button>
        </p>
      )}

      <p>{l.intro}</p>
      {actionData?.error && <p className="form-error" role="alert">{l[actionData.error]}</p>}
      <Form method="post" className="form">
        <input type="hidden" name="next" value={next} />
        <label className="field">
          <span>{l.studentId} <small>{tr.register.studentIdHint}</small></span>
          <input name="studentId" required autoComplete="username" autoCapitalize="characters" defaultValue={actionData?.studentId} />
        </label>
        <label className="field">
          <span>{l.password}</span>
          <input name="password" type="password" required minLength={8} autoComplete="current-password" />
        </label>
        <button className="btn btn-primary" disabled={busy}>{busy ? l.signingIn : l.submit}</button>
      </Form>
      <p className="muted small">{l.forgot}</p>
      <p className="muted small">{l.noPassword}</p>
      <p>{l.noAccount} <Link to="/register">{l.registerHere}</Link></p>

      {!inTelegram && (
        <p className="or-telegram">
          {l.orTelegram}{" "}
          <a className="btn btn-quiet btn-sm" href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">{l.openBot}</a>
        </p>
      )}
      {devLogin && <DevLogin next={next} />}
    </section>
  );
}

/** Local development only — Telegram can't reach localhost. */
function DevLogin({ next }: { next: string }) {
  const nav = useNavigation();
  return (
    <details className="dev-login" lang="en">
      <summary>Developer sign-in (local only)</summary>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const res = await fetch("/api/auth/sign-in/dev", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ telegramId: f.get("telegramId"), name: f.get("name") }),
          });
          if (res.ok) window.location.assign(next);
        }}
      >
        <label>Fake Telegram ID<input name="telegramId" type="number" defaultValue={1001} required /></label>
        <label>Name<input name="name" defaultValue="Test Member" required /></label>
        <button className="btn btn-quiet" disabled={nav.state !== "idle"}>Sign in as test user</button>
      </Form>
    </details>
  );
}
