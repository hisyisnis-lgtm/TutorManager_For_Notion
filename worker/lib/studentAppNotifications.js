import { siteOrigin } from './siteAuth.js';
import { normalizeStudentAppId } from './studentAppAccess.js';
import { StudentTokenSchema } from './schemas.js';

// Temporary coexistence with the preserved production PWA. A verified member
// never falls back to a reservation-code template when member settings fail.
export async function studentHomeworkNotification(env, { studentId, token, kind }) {
  if (!['assign', 'feedback'].includes(kind)) throw new Error('invalid_homework_notice');
  let legacy = false;
  if (env.SITE_LEGACY_STUDENT_APP_ENABLED === 'true') {
    const result = await env.GAME_DB.prepare(`SELECT l.verified_by,l.verified_at,m.status,m.name,
      m.terms_accepted_at,m.privacy_accepted_at FROM site_student_links l
      LEFT JOIN site_members m ON m.id=l.member_id
      WHERE replace(lower(l.student_id),'-','')=?1 LIMIT 2`)
      .bind(normalizeStudentAppId(studentId)).all();
    const rows = result?.results;
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('student_notice_link_unavailable');
    if (rows.length === 0) legacy = true;
    else {
      const row = rows[0];
      if (row.verified_by !== 'teacher' || !Number.isFinite(Date.parse(row.verified_at))
        || row.status !== 'active' || !row.name || !row.terms_accepted_at || !row.privacy_accepted_at) {
        throw new Error('student_notice_link_unavailable');
      }
    }
  }
  if (legacy) {
    // This is the exact fixed button origin of the already approved legacy
    // templates. Do not send a student code to a configurable destination.
    if (env.SITE_LEGACY_STUDENT_APP_ORIGIN !== 'https://tiantian-chinese.pages.dev'
      || !StudentTokenSchema.safeParse(token).success) throw new Error('student_notice_legacy_unavailable');
    return { templateId: kind === 'assign' ? env.KAKAO_TPL_HW_ASSIGN : env.KAKAO_TPL_HW_FEEDBACK,
      variables: { '#{token}': token } };
  }
  return { templateId: kind === 'assign' ? env.KAKAO_TPL_HW_ASSIGN_MEMBER : env.KAKAO_TPL_HW_FEEDBACK_MEMBER,
    variables: { '#{학생앱주소}': `${siteOrigin(env)}/personal/` } };
}
