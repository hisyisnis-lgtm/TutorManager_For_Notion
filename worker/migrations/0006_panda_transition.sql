-- Keep the original migration and receipts intact. Version 0 rows are reset only
-- after the Worker has verified the student's complete Notion earnings snapshot.
ALTER TABLE student_panda_profiles ADD COLUMN transition_version INTEGER NOT NULL DEFAULT 0 CHECK (transition_version >= 0);
ALTER TABLE student_panda_profiles ADD COLUMN transition_initialized_at TEXT;
ALTER TABLE student_panda_profiles ADD COLUMN transition_starting_food INTEGER NOT NULL DEFAULT 0 CHECK (transition_starting_food >= 0);
ALTER TABLE student_panda_profiles ADD COLUMN transition_notice_seen INTEGER NOT NULL DEFAULT 0 CHECK (transition_notice_seen IN (0, 1));
ALTER TABLE student_panda_actions ADD COLUMN transition_version INTEGER NOT NULL DEFAULT 0 CHECK (transition_version >= 0);
