import { asc, eq } from "drizzle-orm";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/property";
import { Field } from "../components/Field";
import { ReceiptInput } from "../components/ReceiptInput";
import { getDb, schema } from "../db";
import { checkReceipt } from "../lib/contributions";
import type { Dict } from "../lib/i18n";
import { CONDITIONS, countByCondition, itemSchema } from "../lib/property";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

type ErrorKey = keyof Dict["errors"];

/** Inventory for the property department (leader and admin too). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "property:manage");
  const items = await getDb(env.DB).select().from(schema.propertyItems).orderBy(asc(schema.propertyItems.name));
  return { items, counts: countByCondition(items) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "property:manage");
  const db = getDb(env.DB);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");

  if (intent === "delete") {
    const item = await db.query.propertyItems.findFirst({ where: eq(schema.propertyItems.id, id), columns: { photoKey: true } });
    await db.delete(schema.propertyItems).where(eq(schema.propertyItems.id, id));
    if (item?.photoKey) await env.MEDIA.delete(item.photoKey);
    return { ok: "deleted" as const };
  }

  const parsed = itemSchema.safeParse({
    name: form.get("name"),
    quantity: form.get("quantity"),
    condition: form.get("condition"),
    location: form.get("location") ?? undefined,
    note: form.get("note") ?? undefined,
  });
  const fieldErrors: Record<string, ErrorKey> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message as ErrorKey;
  const file = form.get("receipt");
  const photo = file instanceof File && file.size > 0 ? checkReceipt(file) : null;
  if (photo && !photo.ok) fieldErrors.receipt = photo.error as ErrorKey;
  if (!parsed.success || Object.keys(fieldErrors).length) return { fieldErrors, forId: id || "new" };

  const itemId = intent === "update" ? id : crypto.randomUUID();
  const existing = intent === "update" ? await db.query.propertyItems.findFirst({ where: eq(schema.propertyItems.id, itemId) }) : undefined;
  if (intent === "update" && !existing) throw new Response("Not found", { status: 404 });

  let photoKey = existing?.photoKey ?? null;
  if (photo?.ok) {
    const newKey = `property/${itemId}-${Date.now()}.${photo.file.type.split("/")[1]}`;
    await env.MEDIA.put(newKey, photo.file.stream(), { httpMetadata: { contentType: photo.file.type } });
    if (photoKey) await env.MEDIA.delete(photoKey);
    photoKey = newKey;
  }
  if (existing) {
    await db.update(schema.propertyItems).set({ ...parsed.data, photoKey, updatedBy: user.id }).where(eq(schema.propertyItems.id, itemId));
  } else {
    await db.insert(schema.propertyItems).values({ id: itemId, ...parsed.data, photoKey, updatedBy: user.id });
  }
  return { ok: "saved" as const };
}

type Item = Route.ComponentProps["loaderData"]["items"][number];

function ItemForm({ item, errors }: { item?: Item; errors?: Record<string, string> }) {
  const { tr } = useT();
  const p = tr.property;
  const busy = useNavigation().state !== "idle";
  const err = (k: string) => (errors?.[k] ? (tr.errors[errors[k] as ErrorKey] as string) : undefined);
  return (
    <Form method="post" encType="multipart/form-data" className="form">
      <input type="hidden" name="intent" value={item ? "update" : "add"} />
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label={p.name} name="name" defaultValue={item?.name} required maxLength={100} error={err("name")} />
      <div className="field-row">
        <Field label={p.quantity} name="quantity" inputMode="numeric" defaultValue={item?.quantity ?? 1} required error={err("quantity")} />
        <label className="field">
          <span>{p.condition}</span>
          <select name="condition" defaultValue={item?.condition ?? "good"}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{p.conditions[c]}</option>)}
          </select>
        </label>
      </div>
      <Field label={p.location} hint={tr.optional} name="location" defaultValue={item?.location ?? ""} maxLength={120} />
      <Field label={p.note} hint={tr.optional} name="note" defaultValue={item?.note ?? ""} maxLength={300} />
      <ReceiptInput label={p.photo} hint={tr.optional} preparing={tr.account.preparing} error={err("receipt")} required={false} />
      <button className="btn btn-primary" disabled={busy}>{tr.save}</button>
    </Form>
  );
}

export default function Property({ loaderData, actionData }: Route.ComponentProps) {
  const { tr } = useT();
  const p = tr.property;
  const busy = useNavigation().state !== "idle";
  const { items, counts } = loaderData;
  const errorsFor = (id: string) => (actionData && "fieldErrors" in actionData && actionData.forId === id ? actionData.fieldErrors : undefined);

  return (
    <section className="page">
      <h1>{p.title}</h1>
      <div className="money-summary">
        {CONDITIONS.map((c) => (
          <div key={c} className={`cond cond--${c}`}><span>{p.conditions[c]}</span><strong>{counts[c]}</strong></div>
        ))}
      </div>
      {actionData && "ok" in actionData && <p className="notice" role="status">{actionData.ok === "deleted" ? p.deleted : tr.saved}</p>}

      <details className="panel upload-panel" open={Boolean(errorsFor("new")) || undefined}>
        <summary>{p.add}</summary>
        <ItemForm key={`new-${items.length}`} errors={errorsFor("new")} />
      </details>

      {items.length === 0 ? <p className="muted">{p.none}</p> : (
        <ul className="property-list">
          {items.map((i) => (
            <li key={i.id} className={`cond--${i.condition}`}>
              {i.photoKey && (
                <a href={`/property/${i.id}/photo`} target="_blank" rel="noreferrer" className="property-photo">
                  <img src={`/property/${i.id}/photo`} alt="" loading="lazy" />
                </a>
              )}
              <div className="property-main">
                <strong>{i.name}</strong> <span className="muted">× {i.quantity}</span>{" "}
                <span className={`pill pill--${i.condition === "good" ? "approved" : i.condition === "worn" ? "pending" : "rejected"}`}>{p.conditions[i.condition]}</span>
                {i.location && <div className="muted">{p.location}: {i.location}</div>}
                {i.note && <div className="muted">{i.note}</div>}
              </div>
              <details className="property-edit" open={Boolean(errorsFor(i.id)) || undefined}>
                <summary>{p.edit}</summary>
                <ItemForm item={i} errors={errorsFor(i.id)} />
                <Form method="post" className="danger-zone" onSubmit={(e) => { if (!confirm(p.confirmDelete)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={i.id} />
                  <button className="btn btn-quiet btn-sm" disabled={busy}>{tr.remove}</button>
                </Form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
