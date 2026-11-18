-- No-op placeholder migration. Exists only so drizzle-kit has an accurate
-- schema snapshot checkpoint (meta/0014_snapshot.json) to diff future
-- `drizzle-kit generate` runs against. All real DDL for this schema state
-- was already applied by hand-authored migrations 0001-0013; their journal
-- entries were reconstructed by hand because meta/ only ever had a 0000
-- snapshot (missing incremental snapshots for 0001-0013).
SELECT 1;
