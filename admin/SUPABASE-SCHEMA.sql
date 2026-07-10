-- ════════════════════════════════════════════════════════════
--  Medway & Kent Removals — Admin dashboard schema
--  Idempotent. Safe to run multiple times in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════
--
--  ⚠️  RLS WARNING — READ THIS BEFORE YOU TOUCH ROW LEVEL SECURITY  ⚠️
--
--  SUPABASE_KEY in this project is the ANON key — the SAME key the public
--  quote form on the website uses to INSERT leads (see api/quote.js).
--
--  Do NOT enable Row Level Security (RLS) on quote_requests or appointments.
--  If you switch RLS on WITHOUT also adding an anon INSERT policy, the public
--  quote form will SILENTLY STOP SAVING LEADS — no error on the site, just
--  lost enquiries. Leave RLS OFF on both tables (this is the default).
--
--  If you ever DO want RLS on, you must swap SUPABASE_KEY to the service_role
--  key for the admin functions AND add an anon INSERT policy for the public
--  form. Until then: RLS stays off.
--
--  ── NOTE on the "notes" column collision ──
--  quote_requests ALREADY has a TEXT column called "notes" (the customer's
--  access / free-text notes from the public form — api/quote.js writes it).
--  We therefore keep internal staff notes in a SEPARATE jsonb column called
--  "admin_notes" so the two never collide.
-- ════════════════════════════════════════════════════════════

-- ── Extend the existing public-form table ──
ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS status      text DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS admin_notes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS value       numeric(10,2),
  ADD COLUMN IF NOT EXISTS address     text,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now();

UPDATE quote_requests SET status = 'new' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS quote_requests_status_idx ON quote_requests (status);

-- ── Appointments / bookings ──
-- lead_id is intentionally NOT a foreign key: the existing quote_requests
-- table may lack a guaranteed unique/PK constraint usable as an FK target.
-- The application manages the relation.
CREATE TABLE IF NOT EXISTS appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          bigint NOT NULL,
  type             text NOT NULL CHECK (type IN ('survey','move')),
  scheduled_for    timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 60,
  address          text,
  notes            text,
  gcal_event_id    text,
  email_sent       boolean DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointments_lead_idx ON appointments (lead_id);

-- ── Call reminders ─────────────────────────────────────────
-- A daily Vercel cron (/api/admin/reminders-run) emails you when remind_on
-- arrives. RLS stays OFF (same anon-key reasoning as above).
CREATE TABLE IF NOT EXISTS reminders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    bigint NOT NULL,
  remind_on  date NOT NULL,
  note       text,
  sent       boolean DEFAULT false,
  sent_at    timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminders_due_idx  ON reminders (remind_on, sent);
CREATE INDEX IF NOT EXISTS reminders_lead_idx ON reminders (lead_id);
