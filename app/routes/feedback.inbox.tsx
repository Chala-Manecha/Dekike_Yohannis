import { desc, eq } from "drizzle-orm";
import { Form, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/feedback.inbox";
import { getDb, schema } from "../db";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "feedback:read");
  const items = await getDb(env.DB)
    .select({
      id: schema.feedback.id,
      category: schema.feedback.category,
      message: schema.feedback.message,
      status: schema.feedback.status,
      leaderNote: schema.feedback.leaderNote,
      createdAt: schema.feedback.createdAt,
      name: schema.members.fullName,
      telegramUsername: schema.user.telegramUsername,
    })
    .from(schema.feedback)
    .leftJoin(schema.user, eq(schema.user.id, schema.feedback.userId))
    .leftJoin(schema.members, eq(schema.members.userId, schema.feedback.userId))
    .orderBy(desc(schema.feedback.createdAt))
    .limit(100);
  return { items };
}

const updateSchema = z.object({
  id: z.string(),
  status: z.enum(["new", "seen", "resolved"]),
  leaderNote: z.string().trim().max(1000).optional(),
});

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "feedback:read");
  const parsed = updateSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) throw new Response("Bad request", { status: 400 });
  await getDb(env.DB)
    .update(schema.feedback)
    .set({ status: parsed.data.status, leaderNote: parsed.data.leaderNote || null, handledBy: user.id })
    .where(eq(schema.feedback.id, parsed.data.id));
  return { ok: true };
}

export default function FeedbackInbox({ loaderData }: Route.ComponentProps) {
  const { tr } = useT();
  const f = tr.feedback;
  const nav = useNavigation();
  return (
    <section className="page">
      <h1>{f.inboxTitle}</h1>
      {loaderData.items.length === 0 ? <p>{f.inboxEmpty}</p> : (
        <ul className="feedback-list">
          {loaderData.items.map((i) => (
            <li key={i.id} className={`feedback-card feedback--${i.status}`}>
              <p className="feedback-meta">
                <span className="badge">{f.categories[i.category]}</span>
                <span>{i.name ?? f.anonymousName}{i.telegramUsername && <> · <a href={`https://t.me/${i.telegramUsername}`} target="_blank" rel="noreferrer">@{i.telegramUsername}</a></>}</span>
                <span className="muted" lang="en">{new Date(i.createdAt).toISOString().slice(0, 10)}</span>
              </p>
              <p className="feedback-message">{i.message}</p>
              <Form method="post" className="inline-form">
                <input type="hidden" name="id" value={i.id} />
                <select name="status" defaultValue={i.status} aria-label="status">
                  {(["new", "seen", "resolved"] as const).map((s) => <option key={s} value={s}>{f.status[s]}</option>)}
                </select>
                <input name="leaderNote" placeholder={f.note} defaultValue={i.leaderNote ?? ""} maxLength={1000} />
                <button className="btn btn-quiet btn-sm" disabled={nav.state !== "idle"}>{f.update}</button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
