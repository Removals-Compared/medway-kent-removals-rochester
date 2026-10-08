# Medway & Kent Removals: what our database (Supabase) actually does

Compiled 9 October 2026 from the live codebase. Purpose: a complete, accurate
requirements list for evaluating alternative database providers. Everything a
replacement must support is in here; nothing else is used.

## 1. The one-line summary

We use exactly one Supabase feature: **a hosted Postgres database with its
automatic REST API (PostgREST)**. We do not use Supabase Auth, Storage,
Realtime, Edge Functions, Vectors, Branching or the client SDK. All access is
plain HTTPS `fetch` calls from Vercel serverless functions using two
environment variables (`SUPABASE_URL`, `SUPABASE_KEY`). The key is the anon
key, used server side only; Row Level Security is OFF on every table and the
application layer does its own auth (HMAC cookies) and permissioning.

## 2. Scale (small by any provider's standard)

- Six tables, largest is a property-listings cache of a few thousand rows;
  the business tables hold hundreds of rows
- Traffic: a lead-gen site plus a one-person admin; peak load is a few
  requests per second, normally far less
- Writes: a handful of leads per day, one weekly bulk upsert of a few
  thousand listing rows, daily cron reads
- Storage: well under 100 MB including indexes
- Region preference: UK or EU

## 3. Data model (full schema in admin/SUPABASE-SCHEMA.sql)

### quote_requests (the leads table, written by the PUBLIC quote form)
- id bigint (auto), name, phone, email, service, from_postcode, to_postcode,
  property_size, move_date, access, notes (all text)
- Admin extensions: status text default 'new', admin_notes jsonb default [],
  value numeric(10,2), costs jsonb default [], address text,
  created_at / updated_at timestamptz default now()
- Index on status

### appointments
- id uuid default gen_random_uuid(), lead_id bigint, type text CHECK
  (survey | move | packing), scheduled_for timestamptz, duration_minutes int,
  address, notes, gcal_event_id text, email_sent boolean, created_at
- Index on lead_id

### reminders
- id uuid, lead_id bigint, remind_on date, remind_time text, note text,
  gcal_event_id text, sent boolean, sent_at timestamptz, created_at
- Indexes on (remind_on, sent) and lead_id

### activity_log
- id uuid, at timestamptz default now(), actor, action, lead_id (text),
  lead_name, detail

### marketing_listings (sold-STC leaflet campaign cache)
- id text PRIMARY KEY (e.g. 'rm-12345'), source, rightmove_id, zoopla_id,
  status, address, district, area, lat/lng double precision, beds int,
  prop_type, price, price_num int, agent, photo, urls, listed_on /
  last_change / stc_seen_on / stc_estimate / stc_date (dates),
  first_seen / last_seen timestamptz, done boolean, done_at, done_by,
  dup_of text, dupe_links jsonb
- Partial index: (stc_date desc) WHERE status <> ''; index on last_seen

### marketing_runs
- id uuid, ran_at timestamptz, five int counters, note text

## 4. Who talks to the database, and how

| Caller | File | Operations |
|---|---|---|
| Public quote form (website + hero form) | api/quote.js | INSERT into quote_requests (fire-and-forget alongside Resend email + Google Sheets log) |
| Admin: lead list, search, add lead | api/admin/quotes.mjs via _db.mjs | SELECT with filters/order/limit, INSERT |
| Admin: lead detail, edit, status, costs, soft-delete, restore, hard delete | api/admin/quote/[id].mjs via _db.mjs | SELECT by id, PATCH, DELETE |
| Admin: bookings (survey/move/packing) | api/admin/appointment.mjs | INSERT, PATCH, SELECT by lead ids, same-day move conflict query |
| Admin: call reminders + daily cron | api/admin/reminder.mjs, reminders-run.mjs | INSERT, PATCH, SELECT due (sent=false, gcal null, date lte today), mark sent |
| Admin: recycle-bin purge (daily cron) | reminders-run.mjs | SELECT status=deleted AND updated_at older than 30 days, then DELETE |
| Admin: activity trail | _db.mjs logActivity/fetchActivity | INSERT (best effort), SELECT latest 30 |
| Admin: duplicate-lead warning | _db.mjs fetchDuplicates | SELECT with OR(phone eq, email eq) AND id neq AND status neq |
| Marketing crawler (weekly cron) | api/admin/_marketing.mjs | BULK UPSERT (on_conflict=id, merge-duplicates) in batches, INSERT run summaries, SELECTs for the Marketing tab |

## 5. The exact API features a replacement must provide

Everything goes through PostgREST URL syntax. A replacement must offer either
(a) the same REST dialect, or (b) plain Postgres access so we can rewrite one
wrapper file with SQL.

Filters used: eq, neq, in.(list), ilike with wildcards, or=(...) across six
columns, gte, lt, lte, is.null, column selection (select=col,col), order
(asc/desc), limit.

Write behaviours used: INSERT returning the row (Prefer:
return=representation), INSERT fire-and-forget (return=minimal), PATCH by id
returning the row, DELETE by filter, **UPSERT with on_conflict=id and
resolution=merge-duplicates** (bulk, hundreds of rows per call).

Postgres features used: jsonb columns (read whole, written whole; no json
operators in queries), numeric(10,2), timestamptz/date, uuid with
gen_random_uuid(), text CHECK constraints, partial index, served over HTTPS
with header auth from Node 20 serverless functions (no connection pooling
managed by us; a REST layer or HTTP driver avoids pool exhaustion on
serverless).

NOT used, so not required: auth/user management, file storage, realtime
subscriptions, websockets, database functions/triggers, full-text search,
extensions beyond pgcrypto's gen_random_uuid, GraphQL, row level security.

## 6. Email, calendar and crons are NOT database features here

Emails go through Resend and Gmail SMTP; calendar through Google Calendar
API; scheduled jobs through Vercel cron and GitHub Actions. A database
alternative does not need any of these.

## 7. Honest cost note before switching

This workload fits inside **Supabase's free tier** (500 MB, 50k monthly
active users irrelevant here, REST API included). If the goal is purely
cost, check which plan the project is on first; downgrading may be the
cheapest "migration" available. The free tier pauses projects after about a
week with zero traffic, but our daily crons keep it active.

## 8. Realistic alternatives, ranked by migration effort

1. **Zero code change**: any hosted Postgres + self-hosted PostgREST, or
   another Supabase project/tier. Only the two env vars change.
2. **One-file rewrite (recommended if leaving)**: a serverless-friendly
   Postgres such as Neon (generous free tier, EU regions, HTTP driver) or
   Vercel Postgres. Work: rewrite api/admin/_db.mjs, the insert block in
   api/quote.js and the upsert helper in _marketing.mjs from PostgREST URLs
   to SQL (about a day including testing), plus a pg_dump/restore of the
   data. Everything in section 5 maps to standard SQL.
3. **Different engine (MySQL/SQLite e.g. PlanetScale, Turso)**: possible but
   loses gen_random_uuid, jsonb defaults and the CHECK syntax as-is; more
   rework for no benefit at this scale. Not recommended.

Questions to ask any candidate provider: EU/UK region? HTTP-friendly access
from serverless (no TCP pool limits)? jsonb? Free/entry tier limits on rows,
storage and requests? Bulk upsert support? Backup/export via pg_dump?
