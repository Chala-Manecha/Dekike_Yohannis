import { eq } from "drizzle-orm";
import { useState } from "react";
import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/register";
import { Choice, Field } from "../components/Field";
import { Turnstile } from "../components/Turnstile";
import { getDb, schema } from "../db";
import { GRADUATION_MONTHS, PROGRAM_YEARS, type AcademicDepartment } from "../config";
import { resolveClass } from "../lib/classyear";
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
  const d = parsed.data;
  const resolved = resolveClass(
    d.standing === "graduate"
      ? { standing: "graduate", department: d.department, graduationYear: d.graduationYear, graduationMonth: d.graduationMonth }
      : { standing: "student", department: d.department, studyYear: d.studyYear, graduationMonth: d.graduationMonth },
    today,
  );
  if (!resolved.ok) {
    fieldErrors[resolved.field] = resolved.field === "graduationYear" ? "classYear" : "studyYear";
    return { formError: "fixFields" as ErrorKey, fieldErrors };
  }

  const db = getDb(env.DB);
  const taken = await db.query.members.findFirst({ where: eq(schema.members.studentId, d.studentId), columns: { id: true } });
  if (taken) return { formError: "fixFields" as ErrorKey, fieldErrors: { studentId: "studentIdTaken" as ErrorKey } };

  try {
    await db
      .insert(schema.members)
      .values({
        fullName: d.fullName,
        christianName: d.christianName,
        gender: d.gender,
        phone: d.phone,
        studentId: d.studentId,
        department: d.department,
        lang: d.lang,
        ...resolved.value,
        registeredYear: today.year,
        userId: user.id,
      })
      .onConflictDoNothing({ target: schema.members.userId });
  } catch {
    // Two people sending the same ID at the same moment: the unique index stops the second
    return { formError: "fixFields" as ErrorKey, fieldErrors: { studentId: "studentIdTaken" as ErrorKey } };
  }
  throw redirect("/me?registered=1");
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const r = tr.register;
  const nav = useNavigation();
  const [dept, setDept] = useState<AcademicDepartment | null>(null);
  const [standing, setStanding] = useState<"student" | "graduate" | null>(null);
  const maxYear = dept ? PROGRAM_YEARS[dept] : Math.max(...Object.values(PROGRAM_YEARS));
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
        <Field label={r.studentId} hint={r.studentIdHint} name="studentId" error={err("studentId")} required autoCapitalize="characters" autoComplete="off" />
        <fieldset className="field" aria-invalid={Boolean(err("department"))}>
          <legend>{r.department}</legend>
          <div className="choices choices--stacked">
            {(["cs", "it", "ee"] as const).map((d) => (
              <label key={d}><input type="radio" name="department" value={d} checked={dept === d} onChange={() => setDept(d)} /> {tr.dept[d]}</label>
            ))}
          </div>
          {err("department") && <span className="field-error">{err("department")}</span>}
        </fieldset>
        <fieldset className="field" aria-invalid={Boolean(err("standing"))}>
          <legend>{r.standing}</legend>
          <div className="choices">
            <label><input type="radio" name="standing" value="student" checked={standing === "student"} onChange={() => setStanding("student")} /> {r.standingStudent}</label>
            <label><input type="radio" name="standing" value="graduate" checked={standing === "graduate"} onChange={() => setStanding("graduate")} /> {r.standingGraduate}</label>
          </div>
          {err("standing") && <span className="field-error">{err("standing")}</span>}
        </fieldset>

        {standing === "student" && (
          <label className="field">
            <span>{r.studyYear} <small>{r.studyHint}</small></span>
            <select name="studyYear" defaultValue="" aria-invalid={Boolean(err("studyYear"))}>
              <option value="">—</option>
              {Array.from({ length: maxYear }, (_, i) => i + 1).map((y) => (
                <option key={y} value={y}>{tr.standing.year(y)}</option>
              ))}
            </select>
            {err("studyYear") && <span className="field-error">{err("studyYear")}</span>}
          </label>
        )}
        {standing === "graduate" && (
          <Field
            label={r.graduationYear}
            hint={r.graduationHint}
            name="graduationYear"
            inputMode="numeric"
            placeholder={String(loaderData.thisYear - 2)}
            error={err("graduationYear")}
            required
          />
        )}
        {standing && (
          <Choice
            legend={standing === "student" ? r.graduationMonthExpected : r.graduationMonth}
            name="graduationMonth"
            error={err("graduationMonth")}
            options={GRADUATION_MONTHS.map((m) => [String(m), tr.months[m - 1]] as [string, string])}
          />
        )}
        <Choice legend={r.lang} name="lang" error={err("lang")} defaultValue={lang} options={[["om", "Afaan Oromoo"], ["am", "አማርኛ"]]} />
        <Turnstile siteKey={loaderData.turnstileSiteKey} />
        <button type="submit" className="btn btn-primary" disabled={nav.state === "submitting"}>
          {nav.state === "submitting" ? r.submitting : r.submit}
        </button>
      </Form>
    </section>
  );
}
