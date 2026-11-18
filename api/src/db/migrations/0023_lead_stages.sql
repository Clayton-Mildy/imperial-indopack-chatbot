-- CRM lead stages: what kind of chat this is, why a lead was lost, the proof for Won/Lost,
-- a history table, per-staff language, and "one OPEN organic lead per contact" (a Lost lead
-- no longer blocks a returning customer from getting a new one).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'lead';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS kind_set_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome_evidence TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS previous_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;

UPDATE leads SET first_contact_at = coalesce(matched_at, submitted_at) WHERE first_contact_at IS NULL;

CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT,
  from_kind TEXT,
  to_kind TEXT,
  actor TEXT NOT NULL,
  staff_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  evidence TEXT,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events (lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_closed ON leads (closed_at);

DROP INDEX IF EXISTS uq_leads_organic_contact;
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_organic_open_contact
  ON leads (contact_id) WHERE request_id IS NULL AND status <> 'lost';

ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'id';
