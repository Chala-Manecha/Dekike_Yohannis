import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { BotLogin } from "../components/BotLogin";
import { getUser, safeRedirect } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const next = safeRedirect(new URL(request.url).searchParams.get("next"), "/me");
  if (await getUser(request, env)) throw redirect(next);
  return { next, devLogin: import.meta.env.DEV };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const { tr } = useT();
  const { next, devLogin } = loaderData;
  const l = tr.login;
  return (
    <section className="page narrow">
      <h1>{tr.login.title}</h1>
      <p>{tr.login.intro}</p>
      <BotLogin next={next} labels={{ open: l.openBot, steps: l.steps, waiting: l.waiting, expired: l.expired, retry: l.retry, failed: l.failed }} />
      {devLogin && <DevLogin next={next} />}
    </section>
  );
}

/** Local development only — the Telegram widget doesn't load on localhost. */
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
          else alert("Dev sign-in failed");
        }}
      >
        <label>Fake Telegram ID<input name="telegramId" type="number" defaultValue={1001} required /></label>
        <label>Name<input name="name" defaultValue="Test Member" required /></label>
        <button className="btn btn-quiet" disabled={nav.state !== "idle"}>Sign in as test user</button>
      </Form>
    </details>
  );
}
