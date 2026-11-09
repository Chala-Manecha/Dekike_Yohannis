import { eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/feedback";
import { getDb, schema } from "../db";
import { can } from "../lib/permissions";
import { requireUser } from "../lib/session.server";
import { useT } from "../lib/use-t";

const feedbackSchema = z.object({
  category: z.enum(schema.FEEDBACK_CATEGORIES),
  message: z.string().trim().min(3).max(2000),
  anonymous: z.literal("on").optional(),
});

async function activeMember(request: Request, env: Env) {
  const user = await requireUser(request, env);
  const m = await getDb(env.DB).query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { status: true } });
  return { user, active: m?.status === "active" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user, active } = await activeMember(request, context.cloudflare.env);
  return { active, canRead: can(user.role, "feedback:read") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const { user, active } = await activeMember(request, env);
  if (!active) throw new Response("Forbidden", { status: 403 });
  const parsed = feedbackSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { sent: false };
  await getDb(env.DB)
    .insert(schema.feedback)
    .values({ category: parsed.data.category, message: parsed.data.message, userId: parsed.data.anonymous ? null : user.id });
  return { sent: true };
}

export default function Feedback({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const f = tr.feedback;
  const nav = useNavigation();
  return (
    <section className="page narrow">
      <h1>{f.title}</h1>
      {loaderData.canRead && <p><Link to="/feedback/inbox">{f.inboxTitle} →</Link></p>}
      {!loaderData.active ? <p>{f.onlyMembers}</p> : actionData?.sent ? (
        <p className="notice" role="status">{f.sent}</p>
      ) : (
        <>
          <p className="intro">{f.intro}</p>
          {actionData?.sent === false && <p className="form-error" role="alert">{tr.errors.message}</p>}
          <Form method="post" className="form">
            <fieldset className="field">
              <legend>{f.category}</legend>
              <div className="choices choices--wrap">
                {schema.FEEDBACK_CATEGORIES.map((c, i) => (
                  <label key={c}><input type="radio" name="category" value={c} defaultChecked={i === 0} /> {f.categories[c]}</label>
                ))}
              </div>
            </fieldset>
            <label className="field"><span>{f.message}</span><textarea name="message" rows={5} minLength={3} maxLength={2000} required /></label>
            <label className="check"><input type="checkbox" name="anonymous" /> {f.anonymous}</label>
            <button className="btn btn-primary" disabled={nav.state !== "idle"}>{f.send}</button>
          </Form>
        </>
      )}
    </section>
  );
}
