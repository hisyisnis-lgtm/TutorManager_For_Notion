-- Explicit student-app entitlement, independent of member/student links and VIP.
-- No automatic grant or seed is performed by this migration.
CREATE TABLE IF NOT EXISTS student_app_access (
  student_id TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision>=1),
  granted_at TEXT,
  granted_by TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  source_batch TEXT,
  last_operation_id TEXT NOT NULL,
  CHECK(length(student_id)=32 AND student_id=lower(student_id) AND student_id NOT GLOB '*[^a-f0-9]*'),
  CHECK((allowed=1 AND granted_at IS NOT NULL AND granted_by IS NOT NULL AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (allowed=0 AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS student_app_access_events (
  event_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES student_app_access(student_id),
  revision INTEGER NOT NULL CHECK(revision>=1),
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  actor TEXT NOT NULL,
  source_batch TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(student_id,revision)
);
