import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/me";
import { ReceiptInput } from "../components/ReceiptInput";
import { getDb, schema } from "../db";
import { checkMonths, checkReceipt, contributionSchema, expectedAmount, payableMonths } from "../lib/contributions";
import { classInfo, duesFor } from "../lib/classyear";
import { getDues } from "../lib/settings.server";
import { departmentOf } from "../lib/permissions";
import { currentDueMonth, monthKey, toEth, type EthMonth } from "../lib/ethiopian";
import { formatEth, standingLabel } from "../lib/i18n";
import { requireUser } from "../lib/session.server";
import { isoToEth, todayIso } from "../lib/dates";
import { eventTitle } from "../lib/notify";
import { AddPanel, Card, PageHead, TabBar, type Tab } from "../components/Layout";
import { markSignedOut } from "../components/TelegramMiniApp";
import { paymentSubmittedNotices } from "../lib/notices";
import { notify, recipientsWithRoles } from "../lib/notices.server";
import { useT } from "../lib/use-t";
import { useState } from "react";

type MonthStatus = "approved" | "pending" | "unpaid";

async function loadMember(db: ReturnType<typeof getDb>, userId: string) {
  return db.query.members.findFirst({ where: eq(schema.members.userId, userId) });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await loadMember(db, user.id);
  const url = new URL(request.url);
  const flags = { registered: url.searchParams.has("registered"), sent: url.searchParams.has("sent") };
  if (!member) return { view: "none", user, member: null, flags } as const;
  const profile = {
    fullName: member.fullName,
    christianName: member.christianName,
    studentId: member.studentId,
    department: member.department,
    gender: member.gender,
    phone: member.phone,
    lang: member.lang,
    interests: member.interests,
    registeredYear: member.registeredYear,
    telegramUsername: user.telegramUsername,
  };
  if (member.status !== "active") return { view: "pending", user, member: { status: member.status, fullName: member.fullName }, profile, standing: classInfo(member, toEth(new Date())), flags } as const;

  const today = toEth(new Date());
  const standing = classInfo(member, today);
  const rate = duesFor(standing, await getDues(db));
  const window = payableMonths(currentDueMonth(today));

  const claimed = await db
    .select({ y: schema.contributionMonths.ethYear, m: schema.contributionMonths.ethMonth, status: schema.contributions.status })
    .from(schema.contributionMonths)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionMonths.contributionId))
    .where(eq(schema.contributionMonths.memberId, member.id));
  const statusByMonth = new Map(claimed.map((c) => [c.y * 100 + c.m, c.status as MonthStatus]));

  const months = window.map((m) => ({ ...m, status: statusByMonth.get(monthKey(m)) ?? ("unpaid" as MonthStatus) }));

  const history = await db
    .select({
      id: schema.contributions.id,
      amount: schema.contributions.amount,
      months: schema.contributions.months,
      status: schema.contributions.status,
      reviewNote: schema.contributions.reviewNote,
      createdAt: schema.contributions.createdAt,
    })
    .from(schema.contributions)
    .where(eq(schema.contributions.memberId, member.id))
    .orderBy(desc(schema.contributions.createdAt))
    .limit(24);

  // Events: what's coming, and attendance at past events since joining
  const iso = todayIso();
  const joined = todayIso(member.createdAt);
  const [upcoming, past, attended] = await Promise.all([
    db
      .select({ id: schema.events.id, type: schema.events.type, title: schema.events.title, date: schema.events.date, time: schema.events.time, place: schema.events.place })
      .from(schema.events)
      .where(and(gte(schema.events.date, iso), eq(schema.events.status, "scheduled")))
      .orderBy(asc(schema.events.date))
      .limit(5),
    db
      .select({ id: schema.events.id, type: schema.events.type, title: schema.events.title, date: schema.events.date })
      .from(schema.events)
      .where(and(lt(schema.events.date, iso), gte(schema.events.date, joined), eq(schema.events.status, "scheduled")))
      .orderBy(desc(schema.events.date))
      .limit(24),
    db.select({ eventId: schema.attendance.eventId }).from(schema.attendance).where(eq(schema.attendance.memberId, member.id)),
  ]);
  const came = new Set(attended.map((a) => a.eventId));
  const myDept = departmentOf(user.role);
  const openTasks = myDept
    ? (await db.select({ id: schema.eventTasks.id }).from(schema.eventTasks).where(and(eq(schema.eventTasks.department, myDept), eq(schema.eventTasks.status, "open")))).length
    : 0;

  return {
    view: "full",
    current: currentDueMonth(today),
    user,
    member: { status: member.status, fullName: member.fullName },
    profile,
    role: user.role,
    myDept,
    openTasks,
    upcoming: upcoming.map((e) => ({ ...e, eth: isoToEth(e.date) })),
    attendance: past.map((e) => ({ ...e, eth: isoToEth(e.date), present: came.has(e.id) })),
    standing,
    rate,
    hasDepartment: departmentOf(user.role) !== null || user.role === "leader" || user.role === "admin",
    months,
    history,
    flags,
  } as const;
}

type ErrorKey = "fixFields" | "months" | "amount" | "receiptMissing" | "receiptType" | "receiptSize" | "monthTaken";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await loadMember(db, user.id);
  if (!member || member.status !== "active") throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const parsed = contributionSchema.safeParse({
    months: form.getAll("months"),
    amount: form.get("amount"),
    reason: form.get("reason") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<string, ErrorKey>> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message as ErrorKey;
    return { error: "fixFields" as ErrorKey, fieldErrors };
  }

  const today = toEth(new Date());
  const standing = classInfo(member, today);
  const rate = duesFor(standing, await getDues(db));
  const months = checkMonths(parsed.data.months, payableMonths(currentDueMonth(today)));
  if (!months) return { error: "months" as ErrorKey, fieldErrors: { months: "months" as ErrorKey } };

  const receipt = checkReceipt(form.get("receipt"));
  if (!receipt.ok) return { error: receipt.error as ErrorKey, fieldErrors: { receipt: receipt.error as ErrorKey } };

  // Cheap check before uploading; the unique index below is the real guard.
  const taken = await db
    .select({ y: schema.contributionMonths.ethYear, m: schema.contributionMonths.ethMonth })
    .from(schema.contributionMonths)
    .where(and(eq(schema.contributionMonths.memberId, member.id), inArray(schema.contributionMonths.ethYear, [...new Set(months.map((m) => m.year))])));
  const takenKeys = new Set(taken.map((t) => t.y * 100 + t.m));
  if (months.some((m) => takenKeys.has(monthKey(m)))) return { error: "monthTaken" as ErrorKey, fieldErrors: { months: "monthTaken" as ErrorKey } };

  const id = crypto.randomUUID();
  const ext = receipt.file.type.split("/")[1];
  const key = `receipts/${member.id}/${id}.${ext}`;
  await env.MEDIA.put(key, receipt.file.stream(), { httpMetadata: { contentType: receipt.file.type } });

  try {
    await db.batch([
      db.insert(schema.contributions).values({
        id,
        memberId: member.id,
        amount: parsed.data.amount,
        monthlyRate: rate,
        memberKind: standing.kind,
        months: months.map((m: EthMonth) => [m.year, m.month] as [number, number]),
        reason: parsed.data.reason,
        receiptKey: key,
      }),
      ...months.map((m) =>
        db.insert(schema.contributionMonths).values({ contributionId: id, memberId: member.id, ethYear: m.year, ethMonth: m.month }),
      ),
    ]);
  } catch (e) {
    await env.MEDIA.delete(key);
    if (String(e).includes("UNIQUE")) return { error: "monthTaken" as ErrorKey, fieldErrors: { months: "monthTaken" as ErrorKey } };
    throw e;
  }

  notify(
    env,
    context.cloudflare.ctx,
    paymentSubmittedNotices(
      await recipientsWithRoles(db, ["finance"]),
      { id, name: member.fullName, amount: parsed.data.amount, months: months.map((m: EthMonth) => [m.year, m.month] as [number, number]) },
      env.PUBLIC_SITE_URL,
    ),
  );
  return redirect("/me?sent=1");
}

export default function Me({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, tr } = useT();
  const a = tr.account;
  const md = tr.memberDash;
  const nav = useNavigation();
  const data = loaderData;
  const [params] = useSearchParams();

  if (data.view === "none") {
    return (
      <section className="page narrow">
        <PageHead title={a.title} />
        <Card>
          <p>{a.notRegistered}</p>
          <p><Link to="/register" className="btn btn-primary">{a.registerNow}</Link></p>
        </Card>
        <SignOut label={tr.nav.signOut} />
      </section>
    );
  }

  const { member, profile } = data;
  const err = (k: string) => {
    const key = actionData?.fieldErrors?.[k as keyof typeof actionData.fieldErrors];
    return key ? (tr.errors[key] as string) : undefined;
  };
  const head = (
    <PageHead
      title={profile.fullName}
      sub={<>{standingLabel(lang, data.standing)} · {tr.dept[profile.department]}{profile.studentId ? ` · ${profile.studentId}` : ""}</>}
      actions={<Link to="/me/account">⚙️ {tr.accountSettings.title}</Link>}
    />
  );

  // Not approved yet (or not active): status and profile only
  if (data.view !== "full") {
    return (
      <section className="page wide">
        {head}
        {data.flags.registered && <p className="notice" role="status">{a.submitted}</p>}
        <Card><p className={`status status-${member.status}`}>{a.status[member.status]}</p></Card>
        <Profile profile={profile} />
        <SignOut label={tr.nav.signOut} />
      </section>
    );
  }

  const thisMonth = data.months.find((m) => m.year === data.current.year && m.month === data.current.month);
  const unpaid = data.months.filter((m) => m.status === "unpaid");
  const attendedCount = data.attendance.filter((x) => x.present).length;
  const tabs: Tab[] = [
    { key: "overview", to: "?tab=overview", label: md.overview, icon: "🏠" },
    { key: "pay", to: "?tab=pay", label: md.payments, icon: "💳", count: unpaid.length, alert: true },
    { key: "attendance", to: "?tab=attendance", label: md.attendance, icon: "🙋" },
    { key: "events", to: "?tab=events", label: md.events, icon: "📅", count: data.upcoming.length },
    { key: "profile", to: "?tab=profile", label: md.profile, icon: "👤" },
  ];
  const tab = tabs.some((t) => t.key === params.get("tab")) ? params.get("tab")! : actionData?.error || data.flags.sent ? "pay" : "overview";
  const statusText = (s: string) => (s === "approved" ? a.paid : s === "pending" ? a.pending : a.unpaid);

  return (
    <section className="page wide">
      {head}
      {data.flags.registered && <p className="notice" role="status">{a.submitted}</p>}
      {data.flags.sent && <p className="notice" role="status">{a.sent}</p>}
      <TabBar tabs={tabs} active={tab} />

      {tab === "overview" && (
        <>
          <div className="mini-stats">
            {thisMonth && (
              <Link to="?tab=pay" className={`mini-stat ${thisMonth.status === "approved" ? "mini-stat--green" : thisMonth.status === "unpaid" ? "mini-stat--red" : ""}`}>
                <strong>{statusText(thisMonth.status)}</strong>
                <span>{md.thisMonth(formatEth(lang, thisMonth))} · {data.rate} {tr.birr}</span>
              </Link>
            )}
            <Link to="?tab=attendance" className="mini-stat">
              <strong>{attendedCount} / {data.attendance.length}</strong>
              <span>{md.attended}</span>
            </Link>
            {data.upcoming[0] && (
              <Link to="?tab=events" className="mini-stat">
                <strong>{data.upcoming[0].eth.day} {tr.months[data.upcoming[0].eth.month - 1]}</strong>
                <span>{eventTitle(lang, data.upcoming[0])}</span>
              </Link>
            )}
            <div className="mini-stat">
              <strong>{tr.roles[data.role]}</strong>
              <span>{md.responsibility}{data.myDept ? ` · ${md.openTasks(data.openTasks)}` : ""}</span>
            </div>
          </div>
          <Card>
            <h2>{tr.register.interests}</h2>
            {profile.interests.length === 0 ? <p className="muted">—</p> : (
              <p className="interests">{profile.interests.map((d) => <span key={d} className="badge">{tr.serviceDept[d as keyof typeof tr.serviceDept] ?? d}</span>)}</p>
            )}
            <p className="me-links">
              {data.myDept && <Link to="/tasks">{tr.tasks.title} →</Link>}
              {data.hasDepartment && !data.myDept && <Link to="/dashboard">{tr.nav.dashboard} →</Link>}
              <Link to="/money">{tr.ledger.publicTitle} →</Link>
              <Link to="/feedback">{a.feedbackLink} →</Link>
            </p>
          </Card>
        </>
      )}

      {tab === "pay" && (
        <>
          <Card>
            <h2>{a.monthsTitle}</h2>
            <p className="muted small">{a.yourDue(data.rate)}</p>
            <ul className="month-grid">
              {data.months.map((m) => (
                <li key={`${m.year}-${m.month}`} className={`month month--${m.status}`}>
                  <span>{formatEth(lang, m)}</span>
                  <small>{statusText(m.status)}</small>
                </li>
              ))}
            </ul>
          </Card>
          {unpaid.length > 0 && (
            <AddPanel label={a.payTitle} open={Boolean(actionData?.error)}>
              <p className="intro">{a.payIntro}</p>
              {actionData?.error && <p className="form-error" role="alert">{tr.errors[actionData.error] as string}</p>}
              <PayForm months={unpaid} rate={data.rate} err={err} submitting={nav.state === "submitting"} />
            </AddPanel>
          )}
          {data.history.length > 0 && (
            <Card>
              <h2>{a.historyTitle}</h2>
              <ul className="history plain">
                {data.history.map((c) => (
                  <li key={c.id}>
                    <div>
                      <strong>{c.amount} {tr.birr}</strong> · {c.months.map(([y, m]) => formatEth(lang, { year: y, month: m })).join(", ")}
                      {c.reviewNote && <p className="row-note">{c.reviewNote}</p>}
                    </div>
                    <span className={`pill pill--${c.status}`}>{a.contribution[c.status]}</span>
                    <a href={`/receipts/${c.id}`} target="_blank" rel="noreferrer">{a.viewReceipt}</a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {tab === "attendance" && (
        <Card>
          <h2>{md.attendance} <span className="muted">({attendedCount} / {data.attendance.length})</span></h2>
          {data.attendance.length === 0 ? <p className="muted">{md.noAttendance}</p> : (
            <ul className="att-list">
              {data.attendance.map((x) => (
                <li key={x.id} className={x.present ? "is-present" : ""}>
                  <span aria-hidden="true">{x.present ? "✅" : "⬜"}</span>
                  <span>{eventTitle(lang, x)}</span>
                  <span className="muted small">{formatEth(lang, x.eth)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "events" && (
        data.upcoming.length === 0 ? <Card><p className="muted">{tr.events.none}</p></Card> : (
          <ul className="event-rows">
            {data.upcoming.map((ev) => (
              <li key={ev.id}>
                <div className={`event-row event-row--${ev.type}`}>
                  <span className="event-date"><b>{ev.eth.day}</b><small>{tr.months[ev.eth.month - 1]}</small></span>
                  <span className="event-main">
                    <strong>{eventTitle(lang, ev)}</strong>
                    <span className="muted small">{tr.events.types[ev.type]}{ev.time ? ` · ${ev.time}` : ""}{ev.place ? ` · ${ev.place}` : ""}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "profile" && <Profile profile={profile} />}

      <SignOut label={tr.nav.signOut} />
    </section>
  );
}

type ProfileData = {
  fullName: string;
  christianName: string | null;
  studentId: string | null;
  department: "cs" | "it" | "ee";
  gender: "male" | "female";
  phone: string;
  lang: "om" | "am";
  interests: string[];
  registeredYear: number;
  telegramUsername: string | null;
};

function Profile({ profile }: { profile: ProfileData }) {
  const { tr } = useT();
  const r = tr.register;
  return (
    <Card>
      <h2>{tr.memberDash.profile}</h2>
      <dl className="kv">
        <dt>{r.fullName}</dt><dd>{profile.fullName}</dd>
        <dt>{r.christianName}</dt><dd>{profile.christianName ?? "—"}</dd>
        <dt>{r.studentId}</dt><dd>{profile.studentId ?? "—"}</dd>
        <dt>{r.department}</dt><dd>{tr.dept[profile.department]}</dd>
        <dt>{r.gender}</dt><dd>{profile.gender === "female" ? r.female : r.male}</dd>
        <dt>{r.phone}</dt><dd>{profile.phone}</dd>
        <dt>Telegram</dt><dd>{profile.telegramUsername ? `@${profile.telegramUsername}` : "—"}</dd>
        <dt>{r.lang}</dt><dd>{profile.lang === "am" ? "አማርኛ" : "Afaan Oromoo"}</dd>
        <dt>{tr.memberDash.since}</dt><dd>{profile.registeredYear}</dd>
      </dl>
      <p><Link to="/me/account" className="btn btn-quiet btn-sm">⚙️ {tr.accountSettings.title}</Link></p>
    </Card>
  );
}

function PayForm({
  months,
  rate,
  err,
  submitting,
}: {
  months: { year: number; month: number }[];
  rate: number;
  err: (k: string) => string | undefined;
  submitting: boolean;
}) {
  const { lang, tr } = useT();
  const a = tr.account;
  const [count, setCount] = useState(0);
  return (
    <Form method="post" encType="multipart/form-data" className="form">
      <fieldset className="field" aria-invalid={Boolean(err("months"))}>
        <legend>{a.selectMonths}</legend>
        <div className="choices choices--wrap">
          {months.map((m) => (
            <label key={`${m.year}-${m.month}`}>
              <input
                type="checkbox"
                name="months"
                value={`${m.year}-${m.month}`}
                onChange={(e) => setCount((c) => c + (e.currentTarget.checked ? 1 : -1))}
              />{" "}
              {formatEth(lang, m)}
            </label>
          ))}
        </div>
        {err("months") && <span className="field-error">{err("months")}</span>}
      </fieldset>
      <label className="field">
        <span>{a.amount} {count > 0 && <small>{a.expected(expectedAmount(rate, count))}</small>}</span>
        <input name="amount" type="number" inputMode="numeric" min={1} required aria-invalid={Boolean(err("amount"))} />
        {err("amount") && <span className="field-error">{err("amount")}</span>}
      </label>
      <label className="field">
        <span>{a.reason} <small>{tr.optional} · {a.reasonHint}</small></span>
        <textarea name="reason" rows={2} maxLength={300} />
      </label>
      <ReceiptInput label={a.receipt} hint={a.receiptHint} preparing={a.preparing} error={err("receipt")} />
      <button type="submit" className="btn btn-primary" disabled={submitting}>{a.submit}</button>
    </Form>
  );
}

function SignOut({ label }: { label: string }) {
  return (
    <>
    <Form method="post" action="/logout" className="signout" onSubmit={markSignedOut}>
      <button className="btn btn-quiet">{label}</button>
    </Form>
    </>
  );
}
