import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/me.account";
import { PageHead } from "../components/Layout";
import { Field } from "../components/Field";
import { getDb } from "../db";
import { getPasswordHash, memberByStudentId, setPasswordHash, telegramIdForUser } from "../lib/accounts.server";
import type { Dict } from "../lib/i18n";
import { hashPassword, passwordSchema, verifyPassword } from "../lib/password";
import { parseInterests, SERVICE_DEPARTMENTS } from "../lib/permissions";
import { studentIdKey, studentIdSchema } from "../lib/registration";
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
  const member = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { studentId: true, interests: true } });
  return {
    studentId: member?.studentId ?? null,
    isMember: Boolean(member),
    interests: member ? member.interests : null,
    hasPassword: Boolean(await getPasswordHash(db, user.id)),
    telegram: (await telegramIdForUser(db, user.id)) ? (user.telegramUsername ? `@${user.telegramUsername}` : "✓") : null,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    botNotify: (await db.query.user.findFirst({ where: eq(schema.user.id, user.id), columns: { botNotify: true } }))?.botNotify ?? true,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const form = await request.formData();
  // Members from before student IDs existed add theirs once (needed to sign in on the website)
  if (form.get("intent") === "studentId") {
    const member = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { id: true, studentId: true } });
    if (!member || member.studentId) throw new Response("Bad request", { status: 400 });
    const parsed = studentIdSchema.safeParse(form.get("studentId") ?? "");
    if (!parsed.success) return { saved: false, interestsSaved: false, fieldErrors: { studentId: "studentId" as ErrorKey } };
    const taken = await memberByStudentId(db, parsed.data);
    if (taken) return { saved: false, interestsSaved: false, fieldErrors: { studentId: "studentIdTaken" as ErrorKey } };
    try {
      await db.update(schema.members).set({ studentId: parsed.data, studentIdKey: studentIdKey(parsed.data) }).where(eq(schema.members.id, member.id));
    } catch {
      return { saved: false, interestsSaved: false, fieldErrors: { studentId: "studentIdTaken" as ErrorKey } };
    }
    return { saved: false, interestsSaved: false, fieldErrors: {} as Record<string, ErrorKey> };
  }
  if (form.get("intent") === "botNotify") {
    await db.update(schema.user).set({ botNotify: form.get("on") === "1" }).where(eq(schema.user.id, user.id));
    return { saved: false, interestsSaved: false, fieldErrors: {} as Record<string, ErrorKey> };
  }
  if (form.get("intent") === "interests") {
    await db.update(schema.members).set({ interests: parseInterests(form.getAll("interests")) }).where(eq(schema.members.userId, user.id));
    return { saved: false, interestsSaved: true, fieldErrors: {} as Record<string, ErrorKey> };
  }
  const current = await getPasswordHash(db, user.id);
  const fieldErrors: Record<string, ErrorKey> = {};
  const next = String(form.get("password") ?? "");
  // Changing needs the current password; setting the first one (or after a reset) doesn't
  if (current && !(await verifyPassword(String(form.get("current") ?? ""), current))) fieldErrors.current = "passwordWrong";
  if (!passwordSchema.safeParse(next).success) fieldErrors.password = "passwordShort";
  else if (next !== form.get("password2")) fieldErrors.password2 = "passwordMismatch";
  if (Object.keys(fieldErrors).length) return { saved: false, interestsSaved: false, fieldErrors };
  await setPasswordHash(db, user.id, await hashPassword(next));
  return { saved: true, interestsSaved: false, fieldErrors };
}

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const a = tr.accountSettings;
  const busy = useNavigation().state !== "idle";
  const err = (k: string) => {
    const key = actionData?.fieldErrors?.[k];
    return key ? (tr.errors[key] as string) : undefined;
  };
  const { studentId, hasPassword, telegram, botUsername, interests, isMember, botNotify } = loaderData;

  return (
    <section className="page narrow">
      <PageHead back={{ to: "/me", label: tr.nav.myPage }} title={a.title} />

      <dl className="facts">
        <dt>{tr.register.studentId}</dt>
        <dd>
          {studentId ?? (isMember ? (
            <Form method="post" className="inline-form">
              <input type="hidden" name="intent" value="studentId" />
              <input name="studentId" placeholder={tr.register.studentIdHint} aria-label={tr.register.studentId} required autoCapitalize="characters" />
              <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.save}</button>
              {err("studentId") && <span className="field-error">{err("studentId")}</span>}
            </Form>
          ) : "—")}
        </dd>
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

      <h2>{a.notifyTitle}</h2>
      <Form method="post" className="notify-switch">
        <input type="hidden" name="intent" value="botNotify" />
        <input type="hidden" name="on" value={botNotify ? "0" : "1"} />
        <span className={`pill ${botNotify ? "pill--approved" : "pill--rejected"}`}>{botNotify ? a.notifyOn : a.notifyOff}</span>
        <button className={`btn btn-sm ${botNotify ? "btn-quiet" : "btn-green"}`} disabled={busy}>{botNotify ? a.turnOff : a.turnOn}</button>
      </Form>
      <p className="muted small">{a.notifyHint}</p>

      {interests && (
        <>
          <h2>{tr.register.interests}</h2>
          {actionData?.interestsSaved && <p className="notice" role="status">{tr.saved}</p>}
          <Form method="post" className="form">
            <input type="hidden" name="intent" value="interests" />
            <div className="choices choices--wrap">
              {SERVICE_DEPARTMENTS.map((d) => (
                <label key={d}><input type="checkbox" name="interests" value={d} defaultChecked={interests.includes(d)} /> {tr.serviceDept[d]}</label>
              ))}
            </div>
            <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.save}</button>
          </Form>
        </>
      )}

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
