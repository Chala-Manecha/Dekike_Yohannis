import { asc, eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/contacts";
import { PageHead } from "../components/Layout";
import { Field } from "../components/Field";
import { getDb, schema } from "../db";
import { contactSchema } from "../lib/contacts";
import type { Dict } from "../lib/i18n";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

type ErrorKey = keyof Dict["errors"];

/** The members department keeps the contact list shown on the homepage. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "contact:manage");
  return { contacts: await getDb(env.DB).select().from(schema.contacts).orderBy(asc(schema.contacts.sort), asc(schema.contacts.name)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "contact:manage");
  const db = getDb(env.DB);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (form.get("intent") === "delete") {
    await db.delete(schema.contacts).where(eq(schema.contacts.id, id));
    return { ok: true };
  }
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, ErrorKey> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message as ErrorKey;
    return { fieldErrors, forId: id || "new" };
  }
  if (id) await db.update(schema.contacts).set(parsed.data).where(eq(schema.contacts.id, id));
  else await db.insert(schema.contacts).values(parsed.data);
  return { ok: true };
}

type Contact = Route.ComponentProps["loaderData"]["contacts"][number];

function ContactForm({ c, errors }: { c?: Contact; errors?: Record<string, string> }) {
  const { tr } = useT();
  const k = tr.contacts;
  const busy = useNavigation().state !== "idle";
  const err = (f: string) => (errors?.[f] ? (tr.errors[errors[f] as ErrorKey] as string) : undefined);
  return (
    <Form method="post" className="form">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label={k.name} name="name" defaultValue={c?.name} required maxLength={80} error={err("name")} />
      <Field label={k.role} hint={k.roleHint} name="role" defaultValue={c?.role ?? ""} maxLength={60} />
      <div className="field-row">
        <Field label={tr.register.phone} name="phone" type="tel" defaultValue={c?.phone ?? ""} placeholder="09XX XXX XXX" error={err("phone")} />
        <Field label="Telegram" hint="@username" name="telegram" defaultValue={c?.telegram ?? ""} error={err("telegram")} />
      </div>
      <Field label={k.order} hint={k.orderHint} name="sort" inputMode="numeric" defaultValue={c?.sort ?? 0} />
      <button className="btn btn-primary" disabled={busy}>{tr.save}</button>
    </Form>
  );
}

export default function Contacts({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const k = tr.contacts;
  const busy = useNavigation().state !== "idle";
  const errorsFor = (id: string) => (actionData && "fieldErrors" in actionData && actionData.forId === id ? actionData.fieldErrors : undefined);
  const { contacts } = loaderData;
  return (
    <section className="page narrow">
      <PageHead back={{ to: "/members", label: tr.members.title }} title={k.manageTitle} />
      <p className="muted">{k.manageHint}</p>
      {actionData && "ok" in actionData && <p className="notice" role="status">{tr.saved}</p>}
      <details className="panel upload-panel" open={Boolean(errorsFor("new")) || contacts.length === 0 || undefined}>
        <summary>{k.add}</summary>
        <ContactForm key={`new-${contacts.length}`} errors={errorsFor("new")} />
      </details>
      <ul className="property-list">
        {contacts.map((c) => (
          <li key={c.id}>
            <div className="property-main">
              <strong>{c.name}</strong>{c.role && <span className="muted"> · {c.role}</span>}
              <div className="muted">{[c.phone, c.telegram && `@${c.telegram}`].filter(Boolean).join(" · ")}</div>
            </div>
            <details className="property-edit" open={Boolean(errorsFor(c.id)) || undefined}>
              <summary>{tr.property.edit}</summary>
              <ContactForm c={c} errors={errorsFor(c.id)} />
              <Form method="post" className="danger-zone" onSubmit={(e) => { if (!confirm(k.confirmDelete)) e.preventDefault(); }}>
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="id" value={c.id} />
                <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.remove}</button>
              </Form>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
