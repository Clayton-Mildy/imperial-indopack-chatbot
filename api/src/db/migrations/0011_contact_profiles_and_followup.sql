-- Contact profiles: extracted customer data from AI conversations (CATAT step)
CREATE TABLE contact_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         uuid NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  customer_type      text,                          -- 'reseller' | 'end_user'
  profile            jsonb NOT NULL DEFAULT '{}',   -- flexible CATAT fields per customer type
  follow_up_status   text NOT NULL DEFAULT 'none',  -- 'none' | 'needs_followup' | 'done'
  follow_up_notes    text,                          -- what to follow up on
  updated_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_profiles_contact ON contact_profiles(contact_id);
CREATE INDEX idx_contact_profiles_followup ON contact_profiles(follow_up_status) WHERE follow_up_status = 'needs_followup';

-- Add follow-up notes to conversations (AI fills this when closing notes need human attention)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS follow_up_notes text;
