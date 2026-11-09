import { and, asc, desc, eq, isNull, like, or, type SQL } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/materials";
import { MaterialUpload } from "../components/MaterialUpload";
import { ACADEMIC_DEPARTMENTS } from "../config";
import { getDb, schema } from "../db";
import { formatBytes, materialKey, MATERIAL_KINDS, MAX_STUDY_YEAR, type MaterialKind } from "../lib/materials";
import { materialAccess } from "../lib/materials.server";
import { useT } from "../lib/use-t";

const LIST_LIMIT = 300;

type Filters = { dept: (typeof ACADEMIC_DEPARTMENTS)[number] | ""; year: number | null; kind: MaterialKind | ""; q: string };

function readFilters(url: URL): Filters {
  const p = url.searchParams;
  const dept = (ACADEMIC_DEPARTMENTS as readonly string[]).includes(p.get("dept") ?? "") ? (p.get("dept") as (typeof ACADEMIC_DEPARTMENTS)[number]) : "";
  const yearNum = Number(p.get("year"));
  const year = Number.isInteger(yearNum) && yearNum >= 1 && yearNum <= MAX_STUDY_YEAR ? yearNum : null;
  const kind = (MATERIAL_KINDS as readonly string[]).includes(p.get("kind") ?? "") ? (p.get("kind") as MaterialKind) : "";
  const q = (p.get("q") ?? "").trim().slice(0, 60);
  return { dept, year, kind, q };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const { user, reviewer, allowed } = await materialAccess(request, env);
  const filters = readFilters(new URL(request.url));
  if (!allowed) return { allowed: false as const, filters };

  const db = getDb(env.DB);
  const m = schema.materials;
  const where: SQL[] = [eq(m.status, "approved")];
  // A department filter also shows "all departments" items; a year filter also shows "any year" items.
  const { dept, kind } = filters;
  if (dept) where.push(or(eq(m.department, dept), eq(m.department, "all"))!);
  if (filters.year) where.push(or(eq(m.studyYear, filters.year), isNull(m.studyYear))!);
  if (kind) where.push(eq(m.kind, kind));
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(like(m.title, pattern), like(m.course, pattern))!);
  }

  const [items, mine, pending, courses] = await Promise.all([
    db.select().from(m).where(and(...where)).orderBy(asc(m.course), desc(m.createdAt)).limit(LIST_LIMIT),
    db.select().from(m).where(and(eq(m.uploadedBy, user.id), or(eq(m.status, "pending"), eq(m.status, "rejected")))).orderBy(desc(m.createdAt)).limit(20),
    reviewer ? db.select().from(m).where(eq(m.status, "pending")).orderBy(asc(m.createdAt)).limit(100) : Promise.resolve([]),
    db.selectDistinct({ course: m.course }).from(m).where(eq(m.status, "approved")).orderBy(asc(m.course)).limit(300),
  ]);
  return { allowed: true as const, filters, reviewer, items, mine, pending, courses: courses.map((c) => c.course) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const { user, reviewer, allowed } = await materialAccess(request, env);
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  const db = getDb(env.DB);
  const form = await request.formData();
  const id = String(form.get("id"));
  const item = await db.query.materials.findFirst({ where: eq(schema.materials.id, id) });
  if (!item) throw new Response("Not found", { status: 404 });
  const where = eq(schema.materials.id, item.id);

  switch (form.get("intent")) {
    case "approve":
      if (!reviewer) break;
      await db.update(schema.materials).set({ status: "approved", reviewedBy: user.id, reviewedAt: new Date() }).where(where);
      return { ok: true };
    case "reject":
      // Keep the row so the uploader sees it was returned; the file itself is removed.
      if (!reviewer) break;
      await db.update(schema.materials).set({ status: "rejected", reviewedBy: user.id, reviewedAt: new Date() }).where(where);
      await env.MEDIA.delete(materialKey(item.id));
      return { ok: true };
    case "delete":
      // Reviewers delete anything; uploaders only their own items that aren't approved yet.
      if (!reviewer && !(item.uploadedBy === user.id && item.status !== "approved")) break;
      await db.delete(schema.materials).where(where);
      await env.MEDIA.delete(materialKey(item.id));
      return { ok: true };
  }
  throw new Response("Forbidden", { status: 403 });
}

type Item = Extract<Route.ComponentProps["loaderData"], { allowed: true }>["items"][number];

export default function Materials({ loaderData }: Route.ComponentProps) {
  const { tr } = useT();
  const m = tr.materials;
  const busy = useNavigation().state !== "idle";
  const { filters } = loaderData;

  if (!loaderData.allowed) {
    return (
      <section className="page narrow">
        <h1>{m.title}</h1>
        <p>{m.onlyMembers}</p>
        <p><Link to="/me">{tr.nav.myPage} →</Link></p>
      </section>
    );
  }
  const { items, mine, pending, courses, reviewer } = loaderData;

  const where = (i: Item) =>
    [i.department === "all" ? m.allDepartments : tr.dept[i.department], i.studyYear ? m.yearN(i.studyYear) : m.anyYear].join(" · ");

  const actionButton = (i: Item, intent: "approve" | "reject" | "delete", label: string, cls = "btn btn-quiet btn-sm") => (
    <Form method="post" onSubmit={intent === "approve" ? undefined : (e) => { if (!confirm(m.confirm[intent])) e.preventDefault(); }}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={i.id} />
      <button className={cls} disabled={busy}>{label}</button>
    </Form>
  );

  const row = (i: Item, extra?: React.ReactNode) => (
    <li key={i.id} className="material">
      <span className={`badge badge--${i.kind}`}>{m.kinds[i.kind]}</span>
      <div className="material-main">
        {i.status === "rejected" ? <strong>{i.title}</strong> : (
          <a href={`/materials/${i.id}/file`} target="_blank" rel="noreferrer"><strong>{i.title}</strong></a>
        )}
        <span className="muted">{i.course} · {where(i)} · {formatBytes(i.fileSize)}</span>
      </div>
      {extra}
    </li>
  );

  // Group the approved list by course for easier browsing
  const groups: [string, Item[]][] = [];
  for (const i of items) {
    const last = groups.at(-1);
    if (last && last[0] === i.course) last[1].push(i);
    else groups.push([i.course, [i]]);
  }

  return (
    <section className="page">
      <h1>{m.title}</h1>
      <p className="intro">{m.intro}</p>

      {reviewer && pending.length > 0 && (
        <section className="panel review-queue" aria-labelledby="queue-h">
          <h2 id="queue-h">{m.toReview(pending.length)}</h2>
          <ul className="materials">
            {pending.map((i) => row(i, (
              <div className="material-actions">
                {actionButton(i, "approve", m.approve, "btn btn-primary btn-sm")}
                {actionButton(i, "reject", m.reject)}
              </div>
            )))}
          </ul>
        </section>
      )}

      <MaterialUpload courses={courses} reviewer={reviewer} />

      {mine.length > 0 && (
        <section aria-labelledby="mine-h">
          <h2 id="mine-h">{m.mine}</h2>
          <ul className="materials">
            {mine.map((i) => row(i, (
              <div className="material-actions">
                <span className={`pill pill--${i.status}`}>{m.status[i.status]}</span>
                {actionButton(i, "delete", tr.remove, "link-btn")}
              </div>
            )))}
          </ul>
        </section>
      )}

      <Form method="get" className="filters" role="search">
        <input type="search" name="q" defaultValue={filters.q} placeholder={m.search} aria-label={m.search} />
        <select name="dept" defaultValue={filters.dept} aria-label={m.department}>
          <option value="">{m.allDepartments}</option>
          {ACADEMIC_DEPARTMENTS.map((d) => <option key={d} value={d}>{tr.dept[d]}</option>)}
        </select>
        <select name="year" defaultValue={filters.year ?? ""} aria-label={m.year}>
          <option value="">{m.anyYear}</option>
          {Array.from({ length: MAX_STUDY_YEAR }, (_, n) => n + 1).map((y) => <option key={y} value={y}>{m.yearN(y)}</option>)}
        </select>
        <select name="kind" defaultValue={filters.kind} aria-label={m.kind}>
          <option value="">{m.allKinds}</option>
          {MATERIAL_KINDS.map((k) => <option key={k} value={k}>{m.kinds[k]}</option>)}
        </select>
        <button className="btn btn-quiet btn-sm">{m.filter}</button>
      </Form>

      {groups.length === 0 ? <p className="muted">{m.none}</p> : groups.map(([course, list]) => (
        <section key={course} className="course-group">
          <h2>{course}</h2>
          <ul className="materials">
            {list.map((i) => row(i, reviewer ? <div className="material-actions">{actionButton(i, "delete", tr.remove, "link-btn")}</div> : undefined))}
          </ul>
        </section>
      ))}
    </section>
  );
}
