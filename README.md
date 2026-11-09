# Project-2 · St. John the Baptist monthly zikr (CS · IT · EE)

Xoofoo ji'aa Qulqulluu Yohaannis Cuuphaa · የቅዱስ ዮሐንስ መጥምቅ ወርሃዊ ዝክር — for Computer Science,
Information Technology and Electrical Engineering students and graduates.

React Router v7 on Cloudflare Workers · D1 + Drizzle · R2 (private receipts) · Better Auth (Telegram login) ·
Telegram bot + Cron · Turnstile. Interface in **Afaan Oromoo (default) and Amharic**.

## What it does

| Area | Who | Where |
|---|---|---|
| Upcoming events (from 3 days before), dues, Telegram group | everyone | `/` |
| Registration: department, graduation year, current year | members | `/register` |
| Month-by-month dues, upload payment screenshot, history | members | `/me` |
| Feedback to the leader (can be anonymous) | members | `/feedback` |
| Approve registrations, member list, assign roles | coordinator · leader | `/members` |
| Review contributions, monthly paid/unpaid, set dues | finance (leader: read-only) | `/finance` |
| Events: create, reschedule, cancel, running order | preparation · leader | `/events` |
| Assign tasks to departments per event | leader | `/events/:id` |
| A department's tasks | department leads | `/tasks` |
| Read and track feedback | leader | `/feedback/inbox` |

**Standing is calculated, not chosen.** Members give their graduation year (E.C.) and current year.
The year goes up every Meskerem; the graduation year shows as **GC**; from Hamle of that year they count
as graduates (`GRADUATION_MONTH` in `app/config.ts`). Dues follow automatically.

**Dues** start at 30 birr (students) / 100 birr (graduates). Finance changes them at `/finance/settings`.
Each contribution stores the rate and standing at the time, so changes never rewrite history.

**Events.** Types: monthly zikr (xoofoo), welcome for new students, farewell for graduates, other
(class / knowledge sharing). A zikr is created automatically for the 30th of this month and the next two
(none in Pagume); preparation or the leader can move it. Rescheduling notifies the group and every member.

## Telegram notifications (automatic)

| When | What | Where |
|---|---|---|
| Event enters the 3-day window | Announcement (Oromo + Amharic) | group |
| 3, 2 and 1 day before a zikr | Reminder to each member who hasn't paid that month | private, bot |
| Zikr day | List of members who haven't paid | group |
| Date changed | Notice of the new date | group + every member |

A cron runs every 30 minutes. Once a day after 08:00 Addis it plans the day's messages; every run sends up
to 40 (Workers free plan limit). Messages wait in the `outbox` table, so nothing is lost or sent twice.
A member only gets private messages if they allowed the bot when signing in with Telegram.

## Roles
`member` · `members_coordinator` · `finance` · `songs` · `property` · `preparation` · `education` · `leader` · `admin`.
The leader assigns department roles from `/members` (but can't create leaders or admins). Rules live in
`app/lib/permissions.ts` and are tested. Make the first admin:
```
npx wrangler d1 execute DB --remote --command "UPDATE user SET role='admin' WHERE telegram_username='your_username'"
```

## Setup (same Cloudflare account as project-1)
1. `npm install`, `cp .dev.vars.example .dev.vars`
2. `npx wrangler d1 create dekike-yohannis-db` → put the id in `wrangler.jsonc` (never project-1's database)
3. R2 → create bucket `dekike-yohannis-receipts`, keep it private
4. `npm run db:migrate:remote`
5. Bot: `/setdomain` → `dekike-yohannis.henon1918.workers.dev`; set `TELEGRAM_BOT_USERNAME`
6. Group id: add the bot to the group as **admin**, send any message in the group, open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (starts with `-100`) into `TELEGRAM_GROUP_CHAT_ID`
7. Worker secrets: `BETTER_AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, `TURNSTILE_SECRET_KEY`
8. Workers & Pages → Import repository; build `npm run build`, deploy `npx wrangler deploy`

Local: `npm run db:migrate:local && npm run dev`, "Developer sign-in" on `/login`.
Trigger the cron locally: open `http://localhost:5173/cdn-cgi/handler/scheduled`.

## Code map
`app/config.ts` group settings · `app/lib/i18n.ts` all text · `app/lib/ethiopian.ts` calendar ·
`app/lib/classyear.ts` standing · `app/lib/notify.ts` who gets which message (pure, tested) ·
`app/lib/notify.server.ts` queue + sending + cron · `app/db/schema.ts` tables · `tests/` 59 tests

## Next round
Learning materials (አለማዊ ትምህርት: exams, assignments, PDFs) · event photos and a moving gallery on the
homepage · songs · property · full money in/out ledger.

## Scripts
`npm run dev` · `npm test` · `npm run typecheck` · `npm run build` · `npm run db:generate`
