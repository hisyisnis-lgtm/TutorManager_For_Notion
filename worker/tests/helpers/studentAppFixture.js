import { readFileSync } from 'node:fs';

// Explicit grants for synthetic, isolated test students only. Adding a fixture
// student, VIP or member link does not make production grant logic automatic.
export function allowSyntheticStudentApps(local, studentIds) {
  local.sqlite.exec(readFileSync(new URL('../../migrations/0011_student_app_access.sql', import.meta.url), 'utf8'));
  for (const value of studentIds) {
    const studentId = value.replaceAll('-', '').toLowerCase();
    local.sqlite.prepare(`INSERT INTO student_app_access(student_id,allowed,revision,granted_at,granted_by,source_batch,last_operation_id)
      VALUES(?1,1,1,'2026-10-07T00:00:00.000Z','synthetic-test-fixture','synthetic-existing-test',?2)`)
      .run(studentId, `synthetic-fixture:${studentId}`);
  }
}
