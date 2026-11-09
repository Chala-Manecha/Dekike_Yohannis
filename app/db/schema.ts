import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date()),
};

/* ---------- Better Auth tables (names/fields must match Better Auth's model) ---------- */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Telegram gives no email; telegram users get a placeholder under .invalid
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("member"),
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  ...timestamps,
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ...timestamps,
});

/* ---------- Group tables ---------- */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const members = sqliteTable(
  "members",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    christianName: text("christian_name"),
    gender: text("gender", { enum: ["male", "female"] }).notNull(),
    phone: text("phone").notNull(),
    // University ID, upper-case. Unique so one person can't register twice (null only for rows from before it existed)
    studentId: text("student_id"),
    department: text("department", { enum: ["cs", "it", "ee"] }).notNull(),
    // Student vs graduate is derived from these (app/lib/classyear.ts)
    graduationYear: integer("graduation_year").notNull(), // Ethiopian year
    graduationMonth: integer("graduation_month").notNull().default(9), // Ethiopian month: 5 = Tir, 9 = Ginbot
    studyYear: integer("study_year"), // year of study at registration; null if already graduated
    registeredYear: integer("registered_year").notNull(), // Ethiopian year of registration
    lang: text("lang", { enum: ["om", "am"] }).notNull(),
    // Service departments the member would like to serve in (app/lib/permissions.ts SERVICE_DEPARTMENTS)
    interests: text("interests", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text("status", { enum: ["pending", "active", "rejected", "inactive"] })
      .notNull()
      .default("pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("members_status_idx").on(t.status), uniqueIndex("members_student_id_unique").on(t.studentId)],
);

/** One uploaded payment (one receipt), covering one or more months. */
export const contributions = sqliteTable(
  "contributions",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(), // birr
    // Rate and standing when submitted, so past records survive rate changes
    monthlyRate: integer("monthly_rate").notNull(),
    memberKind: text("member_kind", { enum: ["student", "graduate"] }).notNull(),
    months: text("months", { mode: "json" }).$type<[number, number][]>().notNull(),
    reason: text("reason"),
    receiptKey: text("receipt_key").notNull(), // private R2 object key
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("contributions_status_idx").on(t.status), index("contributions_member_idx").on(t.memberId)],
);

/**
 * Months claimed by pending or approved contributions. The unique index makes
 * the database refuse paying the same month twice. Rows are removed when a
 * contribution is returned, so the member can resubmit.
 */
export const contributionMonths = sqliteTable(
  "contribution_months",
  {
    contributionId: text("contribution_id")
      .notNull()
      .references(() => contributions.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    ethYear: integer("eth_year").notNull(),
    ethMonth: integer("eth_month").notNull(),
  },
  (t) => [
    uniqueIndex("contribution_months_unique").on(t.memberId, t.ethYear, t.ethMonth),
    index("contribution_months_period_idx").on(t.ethYear, t.ethMonth),
  ],
);

/** Small key/value settings (dues, cron bookkeeping). Values are JSON. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
});

export const EVENT_TYPES = ["zikr", "welcome", "farewell", "other"] as const;

export const events = sqliteTable(
  "events",
  {
    id: id(),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    title: text("title"), // optional for zikr (a default title is shown)
    description: text("description"),
    date: text("date").notNull(), // Gregorian YYYY-MM-DD (Addis Ababa date)
    time: text("time"), // free text, e.g. "8:00 ጠዋት"
    place: text("place"),
    // For zikr: the contribution month this zikr belongs to
    dueYear: integer("due_year"),
    dueMonth: integer("due_month"),
    status: text("status", { enum: ["scheduled", "cancelled"] })
      .notNull()
      .default("scheduled"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("events_date_idx").on(t.date),
    // One zikr per Ethiopian month (other types leave due_* null, which SQLite treats as distinct)
    uniqueIndex("events_zikr_month_unique").on(t.type, t.dueYear, t.dueMonth),
  ],
);

/** Running order of an event (ዝግጅት ክፍል): opening prayer, teaching, songs… */
export const eventProgram = sqliteTable(
  "event_program",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull(),
    part: text("part").notNull(),
    person: text("person"),
  },
  (t) => [index("event_program_event_idx").on(t.eventId)],
);

export const SERVICE_DEPARTMENTS = ["members", "finance", "songs", "property", "preparation", "education"] as const;

/** Work the leader assigns to a department ahead of an event. */
export const eventTasks = sqliteTable(
  "event_tasks",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    department: text("department", { enum: SERVICE_DEPARTMENTS }).notNull(),
    task: text("task").notNull(),
    status: text("status", { enum: ["open", "done"] })
      .notNull()
      .default("open"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    doneBy: text("done_by").references(() => user.id, { onDelete: "set null" }),
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("event_tasks_dept_idx").on(t.department, t.status)],
);

export const FEEDBACK_CATEGORIES = ["suggestion", "complaint", "question", "appreciation"] as const;

/** Members → leader. Anonymous feedback stores no user. */
export const feedback = sqliteTable(
  "feedback",
  {
    id: id(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    category: text("category", { enum: FEEDBACK_CATEGORIES }).notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ["new", "seen", "resolved"] })
      .notNull()
      .default("new"),
    leaderNote: text("leader_note"),
    handledBy: text("handled_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("feedback_status_idx").on(t.status)],
);

/**
 * Telegram messages waiting to be sent. The cron drains it in batches
 * (Workers free plan limits outgoing requests per run). dedupeKey stops the
 * same reminder being queued twice.
 */
export const outbox = sqliteTable(
  "outbox",
  {
    id: id(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    chatId: text("chat_id").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("outbox_status_idx").on(t.status, t.createdAt)],
);

/**
 * Event photos. Files live in R2 under photos/<id>.webp (full) and photos/<id>-t.webp
 * (thumbnail); both are made in the browser. Public: anyone can see them.
 * featured = shown in the moving gallery on the homepage.
 */
export const photos = sqliteTable(
  "photos",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    caption: text("caption"),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("photos_event_idx").on(t.eventId, t.createdAt), index("photos_featured_idx").on(t.featured, t.createdAt)],
);

/**
 * Learning materials (አለማዊ ትምህርት). File in R2 at materials/<id>. Members suggest,
 * Education approves (status). department "all" = every department; studyYear null = any year.
 */
export const materials = sqliteTable(
  "materials",
  {
    id: id(),
    title: text("title").notNull(),
    course: text("course").notNull(),
    department: text("department", { enum: ["cs", "it", "ee", "all"] }).notNull(),
    studyYear: integer("study_year"),
    kind: text("kind", { enum: ["exam", "assignment", "note", "other"] }).notNull(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    index("materials_status_idx").on(t.status, t.createdAt),
    index("materials_filter_idx").on(t.status, t.department, t.studyYear),
    index("materials_uploader_idx").on(t.uploadedBy),
  ],
);

/**
 * Money in/out recorded by Finance (dues are counted from approved contributions, not here).
 * Entries are never deleted: a mistake is voided with a reason, so the history stays auditable.
 * Receipt photo (optional) in private R2 at ledger/<id>.<ext>.
 */
export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: id(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    category: text("category").notNull(), // app/lib/ledger.ts
    amount: integer("amount").notNull(), // birr
    date: text("date").notNull(), // Gregorian YYYY-MM-DD (Addis Ababa day)
    description: text("description").notNull(),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    receiptKey: text("receipt_key"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (t) => [index("ledger_date_idx").on(t.date)],
);

/** Songs (faarfannaa / መዝሙር). Read by active members; the songs department edits. */
export const songs = sqliteTable(
  "songs",
  {
    id: id(),
    title: text("title").notNull(),
    lang: text("lang", { enum: ["om", "am", "gez", "other"] }).notNull(),
    lyrics: text("lyrics").notNull(),
    // Optional recording in private R2 (songs/<id>.<ext>), members only
    audioKey: text("audio_key"),
    audioType: text("audio_type"),
    audioSize: integer("audio_size"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("songs_title_idx").on(t.title)],
);

/** Songs chosen for an event, in singing order. */
export const eventSongs = sqliteTable(
  "event_songs",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull(),
  },
  (t) => [uniqueIndex("event_songs_unique").on(t.eventId, t.songId), index("event_songs_event_idx").on(t.eventId, t.sort)],
);

/** Property (qabeenya / ንብረት) inventory. Photo (optional) in private R2 at property/<id>.<ext>. */
export const propertyItems = sqliteTable("property_items", {
  id: id(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  condition: text("condition", { enum: ["good", "worn", "broken"] }).notNull(),
  location: text("location"),
  note: text("note"),
  photoKey: text("photo_key"),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
});

/** Property lent out: who, how many, until when; returnedAt set when it comes back. */
export const propertyLoans = sqliteTable(
  "property_loans",
  {
    id: id(),
    itemId: text("item_id")
      .notNull()
      .references(() => propertyItems.id, { onDelete: "cascade" }),
    borrower: text("borrower").notNull(),
    phone: text("phone"),
    quantity: integer("quantity").notNull(),
    outDate: text("out_date").notNull(), // YYYY-MM-DD
    dueDate: text("due_date"), // YYYY-MM-DD, optional
    note: text("note"),
    returnedAt: integer("returned_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    returnedBy: text("returned_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("property_loans_item_idx").on(t.itemId, t.returnedAt)],
);

/** Public contact people, kept by the members department (shown on the homepage). */
export const contacts = sqliteTable("contacts", {
  id: id(),
  name: text("name").notNull(),
  role: text("role"), // e.g. "Leader", "Finance"
  phone: text("phone"),
  telegram: text("telegram"), // username without @
  sort: integer("sort").notNull().default(0),
  ...timestamps,
});

/** Wrong-password counter per student ID (app/lib/login-limit.ts). */
export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull(),
  windowStart: integer("window_start").notNull(), // ms since epoch
});

/** Registration in the bot, one question at a time (app/lib/bot-register.ts). One row per chat. */
export const botRegistrations = sqliteTable("bot_registrations", {
  chatId: text("chat_id").primaryKey(),
  step: text("step").notNull(),
  data: text("data", { mode: "json" }).$type<Record<string, string>>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Member = typeof members.$inferSelect;
export type Contribution = typeof contributions.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Material = typeof materials.$inferSelect;
