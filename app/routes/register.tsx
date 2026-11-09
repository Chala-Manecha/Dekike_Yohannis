import { eq } from "drizzle-orm";
import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/register";
import { Choice, Field } from "../components/Field";
import { Turnstile } from "../components/Turnstile";
import { getDb, schema } from "../db";
import { checkClassFields } from "../lib/classyear";
import { toEth } from "../lib/ethiopian";
import type { Dict } from "../lib/i18n";
import { registrationSchema } from "../lib/registration";
import { requireUser } from "../lib/session.server";
import { verifyTurnstile } from "../lib/turnstile.server";
import { useT } from "../lib/use-t";

type ErrorKey = keyof Dict["errors"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const existing = await getDb(env.DB).query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { id: true } });
  if (existing) throw redirect("/me");
  return { userName: user.name, turnstileSiteKey: env.TURNSTILE_SITE_KEY, thisYear: toEth(new Date()).year };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const form = await request.formData();

  const human = await verifyTurnstile(form.get("cf-turnstile-response"), env.TURNSTILE_SECRET_KEY, request.headers.get("CF-Connecting-IP"));
  if (!human) return { formError: "security" as ErrorKey, fieldErrors: {} as Record<string, ErrorKey> };

  const parsed = registrationSchema.safeParse(Object.fromEntries(form));
  const fieldErrors: Record<string, ErrorKey> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message as ErrorKey;
    return { formError: "fixFields" as ErrorKey, fieldErrors };
  }
  const today = toEth(new Date());
  const classError = checkClassFields(parsed.data.graduationYear, parsed.data.studyYear, today);
  if (classError) {
    fieldErrors[classError === "classYear" ? "graduationYear" : "studyYear"] = classError;
    return { formError: "fixFields" as ErrorKey, fieldErrors };
  }

  await getDb(env.DB)
    .insert(schema.members)
    .values({ ...parsed.data, registeredYear: today.year, userId: user.id })
    .onConflictDoNothing({ target: schema.members.userId });
  throw redirect("/me?registered=1");
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const r = tr.register;
  const nav = useNavigation();
  const err = (k: string) => {
    const key = actionData?.fieldErrors?.[k];
    return key ? (tr.errors[key] as string) : undefined;
  };

  return (
    <section className="page narrow">
      <h1>{r.title}</h1>
      <p className="intro">{r.intro}</p>
      {actionData?.formError && <p className="form-error" role="alert">{tr.errors[actionData.formError] as string}</p>}

      <Form method="post" className="form" noValidate>
        <Field label={r.fullName} name="fullName" error={err("fullName")} defaultValue={loaderData.userName} required autoComplete="name" />
        <Field label={r.christianName} hint={tr.optional} name="christianName" error={err("christianName")} />
        <Choice legend={r.gender} name="gender" error={err("gender")} options={[["male", r.male], ["female", r.female]]} />
        <Field label={r.phone} name="phone" type="tel" inputMode="tel" placeholder="09XX XXX XXX" error={err("phone")} required autoComplete="tel" />
        <Choice legend={r.department} name="department" error={err("department")} options={[["cs", tr.dept.cs], ["it", tr.dept.it], ["ee", tr.dept.ee]]} stacked />
        <Field
          label={r.graduationYear}
          hint={r.graduationHint}
          name="graduationYear"
          inputMode="numeric"
          placeholder={String(loaderData.thisYear + 1)}
          error={err("graduationYear")}
          required
        />
        <label className="field">
          <span>{r.studyYear} <small>{r.studyHint}</small></span>
          <select name="studyYear" defaultValue="" aria-invalid={Boolean(err("studyYear"))}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5, 6, 7].map((y) => (
              <option key={y} value={y}>{tr.standing.year(y)}</option>
            ))}
          </select>
          {err("studyYear") && <span className="field-error">{err("studyYear")}</span>}
        </label>
        <Choice legend={r.lang} name="lang" error={err("lang")} defaultValue={lang} options={[["om", "Afaan Oromoo"], ["am", "አማርኛ"]]} />
        <Turnstile siteKey={loaderData.turnstileSiteKey} />
        <button type="submit" className="btn btn-primary" disabled={nav.state === "submitting"}>
          {nav.state === "submitting" ? r.submitting : r.submit}
        </button>
      </Form>
    </section>
  );
}
