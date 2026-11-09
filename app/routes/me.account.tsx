import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/me.account";
import { Field } from "../components/Field";
import { getDb } from "../db";
import { getPasswordHash, setPasswordHash, telegramIdForUser } from "../lib/accounts.server";
import type { Dict } from "../lib/i18n";
import { hashPassword, passwordSchema, verifyPassword } from "../lib/password";
import { requireUser } from "../lib/session.server";
import { useT } from "../lib/use-t";
import { eq } from "drizzle-orm";
import { schema } from "../db";

type ErrorKey = keyof Dict["errors"];

/** Website password (sign-in with student ID) and the linked Telegram account. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { studentId: true } });
  return {
    studentId: member?.studentId ?? null,
    hasPassword: Boolean(await getPasswordHash(db, user.id)),
    telegram: (await telegramIdForUser(db, user.id)) ? (user.telegramUsername ? `@${user.telegramUsername}` : "✓") : null,
    botUsername: env.TELEGRAM_BOT_USERNAME,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const form = await request.formData();
  const current = await getPasswordHash(db, user.id);
  const fieldErrors: Record<string, ErrorKey> = {};
  const next = String(form.get("password") ?? "");
  // Changing needs the current password; setting the first one (or after a reset) doesn't
  if (current && !(await verifyPassword(String(form.get("current") ?? ""), current))) fieldErrors.current = "passwordWrong";
  if (!passwordSchema.safeParse(next).success) fieldErrors.password = "passwordShort";
  else if (next !== form.get("password2")) fieldErrors.password2 = "passwordMismatch";
  if (Object.keys(fieldErrors).length) return { saved: false, fieldErrors };
  await setPasswordHash(db, user.id, await hashPassword(next));
  return { saved: true, fieldErrors };
}

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const a = tr.accountSettings;
  const busy = useNavigation().state !== "idle";
  const err = (k: string) => {
    const key = actionData?.fieldErrors?.[k];
    return key ? (tr.errors[key] as string) : undefined;
  };
  const { studentId, hasPassword, telegram, botUsername } = loaderData;

  return (
    <section className="page narrow">
      <p><Link to="/me">← {tr.account.title}</Link></p>
      <h1>{a.title}</h1>

      <dl className="facts">
        <dt>{tr.register.studentId}</dt>
        <dd>{studentId ?? "—"}</dd>
        <dt>Telegram</dt>
        <dd>
          {telegram ?? (
            <>
              {a.telegramNotLinked}{" "}
              <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">{a.openBot}</a>
            </>
          )}
        </dd>
      </dl>

      <h2>{hasPassword ? a.changePassword : a.setPassword}</h2>
      {!hasPassword && <p className="muted">{a.setPasswordHint}</p>}
      {actionData?.saved && <p className="notice" role="status">{a.saved}</p>}
      <Form method="post" className="form" key={actionData?.saved ? "saved" : "form"}>
        {hasPassword && <Field label={a.current} name="current" type="password" autoComplete="current-password" required error={err("current")} />}
        <Field label={tr.register.password} hint={tr.register.passwordHint} name="password" type="password" autoComplete="new-password" minLength={8} required error={err("password")} />
        <Field label={tr.register.password2} name="password2" type="password" autoComplete="new-password" minLength={8} required error={err("password2")} />
        <button className="btn btn-primary" disabled={busy}>{tr.save}</button>
      </Form>
    </section>
  );
}
