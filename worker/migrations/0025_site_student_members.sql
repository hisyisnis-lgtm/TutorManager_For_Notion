-- The website member is the student account. Provisioning a teaching record is
-- an explicit teacher action, never a dependency of signup or a payment grant.
CREATE TABLE IF NOT EXISTS site_student_enrollments (
  member_id TEXT PRIMARY KEY REFERENCES site_members(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK(mode IN ('new','existing')),
  target_student_id TEXT,
  student_id TEXT,
  reservation_code TEXT UNIQUE,
  member_snapshot TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','creating','created','unknown','linked','granted')),
  grant_base_revision INTEGER CHECK(grant_base_revision>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((mode='new' AND reservation_code IS NOT NULL AND target_student_id IS NULL)
    OR (mode='existing' AND reservation_code IS NULL AND target_student_id IS NOT NULL))
);
-- Do not backfill a unique index onto legacy links: old duplicate links need
-- operator review, not a failed deployment or an arbitrary account selection.
-- Every new link reserves both identities atomically, checking legacy rows too.
CREATE TABLE IF NOT EXISTS site_student_identity_claims (
  student_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE REFERENCES site_members(id),
  created_at TEXT NOT NULL,
  CHECK(length(student_id)=32 AND student_id=lower(student_id) AND student_id NOT GLOB '*[^a-f0-9]*')
);
CREATE INDEX IF NOT EXISTS idx_site_members_student_queue ON site_members(status,created_at DESC,id DESC);
