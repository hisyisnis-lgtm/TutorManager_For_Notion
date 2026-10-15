-- D1 remains the entitlement authority. A student app and homework management
-- are one teacher setting; Notion VIP must be confirmed before granting access.
CREATE TABLE IF NOT EXISTS student_app_homework_sync (
  student_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  requested_allowed INTEGER NOT NULL CHECK(requested_allowed IN (0,1)),
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  result_revision INTEGER CHECK(result_revision>=0),
  state TEXT NOT NULL CHECK(state IN ('processing','unknown','synced','failed')),
  lease_token TEXT,
  lease_until INTEGER,
  write_target INTEGER CHECK(write_target IN (0,1)),
  write_before INTEGER CHECK(write_before IN (0,1)),
  write_started_at TEXT,
  verified_allowed INTEGER CHECK(verified_allowed IN (0,1)),
  error_code TEXT,
  updated_at TEXT NOT NULL,
  CHECK(length(student_id)=32 AND student_id=lower(student_id) AND student_id NOT GLOB '*[^a-f0-9]*'),
  CHECK(state!='processing' OR (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_student_app_homework_sync_state ON student_app_homework_sync(state,lease_until);
