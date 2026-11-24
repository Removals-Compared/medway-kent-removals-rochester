-- Lead attachments (quotes, photos, signed forms) shown on the admin lead page.
-- The API creates this table automatically on first use (api/admin/_db.mjs),
-- so running this by hand is optional. Kept here as the record of the schema.
CREATE TABLE IF NOT EXISTS lead_attachments (
  id          bigserial PRIMARY KEY,
  lead_id     text        NOT NULL,
  filename    text        NOT NULL,
  mime        text        NOT NULL,
  size        integer     NOT NULL,
  data_b64    text        NOT NULL,
  uploaded_by text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_attachments_lead_idx ON lead_attachments (lead_id);
