import { and, asc, eq, isNull } from "drizzle-orm";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/property";
import { Field } from "../components/Field";
import { ReceiptInput } from "../components/ReceiptInput";
import { getDb, schema } from "../db";
import { checkReceipt } from "../lib/contributions";
import type { Dict } from "../lib/i18n";
import { CONDITIONS, countByCondition, isOverdue, itemSchema, loanSchema, outByItem } from "../lib/property";
import { addDaysIso, isoToEth, todayIso } from "../lib/dates";
import { formatEth } from "../lib/i18n";
import { requirePermission } from "../lib/session.server";
import { useT } from "../lib/use-t";

type ErrorKey = keyof Dict["errors"];

/** Inventory for the property department (leader and admin too). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "property:manage");
  const db = getDb(env.DB);
  const [items, loans] = await Promise.all([
    db.select().from(schema.propertyItems).orderBy(asc(schema.propertyItems.name)),
    db.select().from(schema.propertyLoans).where(isNull(schema.propertyLoans.returnedAt)).orderBy(asc(schema.propertyLoans.dueDate)),
  ]);
  const today = todayIso();
  const out = outByItem(loans);
  const names = new Map(items.map((i) => [i.id, i.name]));
  return {
    items: items.map((i) => ({ ...i, out: out.get(i.id) ?? 0 })),
    counts: countByCondition(items),
    loans: loans.map((l) => ({
      ...l,
      itemName: names.get(l.itemId) ?? "?",
      overdue: isOverdue(l, today),
      outEth: isoToEth(l.outDate),
      dueEth: l.dueDate ? isoToEth(l.dueDate) : null,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "property:manage");
  const db = getDb(env.DB);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");

  if (intent === "lend") {
    const item = await db.query.propertyItems.findFirst({ where: eq(schema.propertyItems.id, id) });
    if (!item) throw new Response("Not found", { status: 404 });
    const parsed = loanSchema.safeParse({ borrower: form.get("borrower"), phone: form.get("phone") ?? undefined, quantity: form.get("quantity"), note: form.get("note") ?? undefined });
    const fieldErrors: Record<string, ErrorKey> = {};
    if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message as ErrorKey;
    const active = await db.select({ q: schema.propertyLoans.quantity }).from(schema.propertyLoans).where(and(eq(schema.propertyLoans.itemId, id), isNull(schema.propertyLoans.returnedAt)));
    const available = item.quantity - active.reduce((n, l) => n + l.q, 0);
    if (parsed.success && parsed.data.quantity > available) fieldErrors.quantity = "notAvailable";
    if (!parsed.success || Object.keys(fieldErrors).length) return { fieldErrors, forId: `lend-${id}` };
    const days = Number(form.get("days"));
    const today = todayIso();
    await db.insert(schema.propertyLoans).values({
      itemId: id,
      ...parsed.data,
      outDate: today,
      dueDate: [1, 3, 7, 14, 30].includes(days) ? addDaysIso(today, days) : null,
      createdBy: user.id,
    });
    return { ok: "lent" as const };
  }

  if (intent === "returned") {
    await db
      .update(schema.propertyLoans)
      .set({ returnedAt: new Date(), returnedBy: user.id })
      .where(and(eq(schema.propertyLoans.id, String(form.get("loanId"))), isNull(schema.propertyLoans.returnedAt)));
    return { ok: "returned" as const };
  }

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

function LendForm({ itemId, available, errors }: { itemId: string; available: number; errors?: Record<string, string> }) {
  const { tr } = useT();
  const p = tr.property;
  const busy = useNavigation().state !== "idle";
  const err = (k: string) => (errors?.[k] ? (tr.errors[errors[k] as ErrorKey] as string) : undefined);
  return (
    <Form method="post" className="form">
      <input type="hidden" name="intent" value="lend" />
      <input type="hidden" name="id" value={itemId} />
      <Field label={p.borrower} name="borrower" required maxLength={100} error={err("borrower")} />
      <Field label={tr.register.phone} hint={tr.optional} name="phone" type="tel" maxLength={30} />
      <div className="field-row">
        <Field label={p.quantity} hint={p.available(available)} name="quantity" inputMode="numeric" defaultValue={1} required error={err("quantity")} />
        <label className="field">
          <span>{p.dueIn}</span>
          <select name="days" defaultValue="7">
            <option value="0">—</option>
            {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{p.days(d)}</option>)}
          </select>
        </label>
      </div>
      <Field label={p.note} hint={tr.optional} name="note" maxLength={200} />
      <button className="btn btn-primary" disabled={busy}>{p.lend}</button>
    </Form>
  );
}

export default function Property({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const p = tr.property;
  const busy = useNavigation().state !== "idle";
  const { items, counts, loans } = loaderData;
  const errorsFor = (id: string) => (actionData && "fieldErrors" in actionData && actionData.forId === id ? actionData.fieldErrors : undefined);

  return (
    <section className="page">
      <h1>{p.title}</h1>
      <div className="money-summary">
        {CONDITIONS.map((c) => (
          <div key={c} className={`cond cond--${c}`}><span>{p.conditions[c]}</span><strong>{counts[c]}</strong></div>
        ))}
      </div>
      {actionData && "ok" in actionData && (
        <p className="notice" role="status">{actionData.ok === "deleted" ? p.deleted : actionData.ok === "lent" ? p.lent : actionData.ok === "returned" ? p.returnedDone : tr.saved}</p>
      )}

      {loans.length > 0 && (
        <section className="panel loans" aria-labelledby="loans-h">
          <h2 id="loans-h">{p.lentOut} ({loans.length})</h2>
          <ul>
            {loans.map((l) => (
              <li key={l.id} className={l.overdue ? "is-overdue" : ""}>
                <div>
                  <strong>{l.itemName}</strong> × {l.quantity} → {l.borrower}
                  {l.phone && <> · <a href={`tel:${l.phone}`}>{l.phone}</a></>}
                  <div className="muted small">
                    {p.since} {formatEth(lang, l.outEth)}
                    {l.dueEth && <> · {l.overdue ? <strong className="money-out">{p.overdue}: {formatEth(lang, l.dueEth)}</strong> : <>{p.due} {formatEth(lang, l.dueEth)}</>}</>}
                    {l.note && <> · {l.note}</>}
                  </div>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="returned" />
                  <input type="hidden" name="loanId" value={l.id} />
                  <button className="btn btn-quiet btn-sm" disabled={busy}>{p.markReturned}</button>
                </Form>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                {i.out > 0 && <span className="muted">({p.outCount(i.out, i.quantity - i.out)})</span>}{" "}
                <span className={`pill pill--${i.condition === "good" ? "approved" : i.condition === "worn" ? "pending" : "rejected"}`}>{p.conditions[i.condition]}</span>
                {i.location && <div className="muted">{p.location}: {i.location}</div>}
                {i.note && <div className="muted">{i.note}</div>}
              </div>
              {i.quantity - i.out > 0 && (
                <details className="property-edit" open={Boolean(errorsFor(`lend-${i.id}`)) || undefined}>
                  <summary>{p.lend}</summary>
                  <LendForm itemId={i.id} available={i.quantity - i.out} errors={errorsFor(`lend-${i.id}`)} />
                </details>
              )}
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
