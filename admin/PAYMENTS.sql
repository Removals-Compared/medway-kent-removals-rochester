-- ════════════════════════════════════════════════════════════
--  Medway & Kent Removals — online payment columns (Stripe)
--  Idempotent. Run once in the Neon SQL editor BEFORE the instant
--  quote & pay goes live. It only adds columns; nothing is removed.
-- ════════════════════════════════════════════════════════════
ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS to_address         text,
  ADD COLUMN IF NOT EXISTS payment_status     text,          -- awaiting | paid
  ADD COLUMN IF NOT EXISTS payment_option     text,          -- deposit | klarna
  ADD COLUMN IF NOT EXISTS payment_method     text,          -- card | klarna
  ADD COLUMN IF NOT EXISTS amount_paid        numeric(10,2),
  ADD COLUMN IF NOT EXISTS stripe_session_id  text,
  ADD COLUMN IF NOT EXISTS paid_at            timestamptz;

CREATE INDEX IF NOT EXISTS quote_requests_stripe_session_idx
  ON quote_requests (stripe_session_id);
