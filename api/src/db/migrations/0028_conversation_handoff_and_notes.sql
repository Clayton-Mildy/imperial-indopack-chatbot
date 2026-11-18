-- Why the chat was handed to the team (the Perlu Tim queue groups by it), and the team's own notes on
-- the conversation. The category is written with the hand-off and cleared with the reason when the
-- chat leaves the held state; the notes are written by staff from the dashboard.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_category text CHECK (handoff_category IN ('harga_custom','desain_masuk','pesanan_besar','minta_orang','komplain','bukan_pembeli','lainnya')),
  ADD COLUMN IF NOT EXISTS team_notes text,
  ADD COLUMN IF NOT EXISTS team_notes_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS team_notes_updated_by text;
