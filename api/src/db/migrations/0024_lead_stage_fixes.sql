-- Lead-stage follow-ups (0023 is already applied, so these are a migration of their own).
-- Every "current lead", waiting-time and /new query filters leads by contact_id, which only the
-- partial organic index covered. And a Won/Lost lead from before 0023 has no closed_at, so the
-- report's won/lost-by-closing-day counts never saw it: date it by the last human edit, else the
-- last update (the same fallback the reopen window already used).
CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads (contact_id);

UPDATE leads SET closed_at = coalesce(human_updated_at, updated_at)
WHERE status IN ('won', 'lost') AND closed_at IS NULL;
