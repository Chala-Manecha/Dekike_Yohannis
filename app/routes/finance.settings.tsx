import { Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/finance.settings";
import { FinanceHead } from "../components/FinanceHead";
import { getDb } from "../db";
import { getDues, setSetting } from "../lib/settings.server";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

const duesSchema = z.object({
  student: z.coerce.number().int().min(0).max(10_000),
  graduate: z.coerce.number().int().min(0).max(10_000),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "dues:set");
  return { dues: await getDues(getDb(env.DB)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "dues:set");
  const parsed = duesSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false as const };
  await setSetting(getDb(env.DB), "dues", parsed.data, user.id);
  return { ok: true as const };
}

export default function FinanceSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const f = tr.finance;
  const nav = useNavigation();
  return (
    <section className="page wide">
      <FinanceHead active="settings" canSettings sub={f.settingsTitle} />
      <div className="card narrow-card">
      <p className="intro">{f.settingsIntro}</p>
      {actionData?.ok === true && <p className="notice" role="status">{tr.saved}</p>}
      {actionData?.ok === false && <p className="form-error" role="alert">{tr.errors.amount}</p>}
      <Form method="post" className="form">
        <label className="field"><span>{f.studentRate}</span><input name="student" type="number" min={0} inputMode="numeric" defaultValue={loaderData.dues.student} required /></label>
        <label className="field"><span>{f.graduateRate}</span><input name="graduate" type="number" min={0} inputMode="numeric" defaultValue={loaderData.dues.graduate} required /></label>
        <button className="btn btn-primary" disabled={nav.state !== "idle"}>{tr.save}</button>
      </Form>
      </div>
    </section>
  );
}
