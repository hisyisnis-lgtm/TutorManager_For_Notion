import { describe, expect, it, vi } from 'vitest';
import { studentHomeworkNotification } from '../lib/studentAppNotifications.js';

const ID = '11111111-1111-4111-8111-111111111111';
const input = { studentId: ID, token: 'ABCDEF123456', kind: 'assign' };
function config(rows = []) {
  const all = vi.fn(async () => ({ results: rows }));
  const bind = vi.fn(() => ({ all }));
  return { SITE_LEGACY_STUDENT_APP_ENABLED: 'true', SITE_LEGACY_STUDENT_APP_ORIGIN: 'https://tiantian-chinese.pages.dev',
    KAKAO_TPL_HW_ASSIGN: 'old-assign', KAKAO_TPL_HW_FEEDBACK: 'old-feedback',
    KAKAO_TPL_HW_ASSIGN_MEMBER: 'new-assign', KAKAO_TPL_HW_FEEDBACK_MEMBER: 'new-feedback',
    GAME_DB: { prepare: vi.fn(() => ({ bind })) } };
}
const linked = { verified_by: 'teacher', verified_at: '2026-10-15T00:00:00Z', status: 'active', name: '합성',
  terms_accepted_at: '2026-10-15', privacy_accepted_at: '2026-10-15' };
describe('student homework notification during the reviewed legacy rollout', () => {
  it.each(['assign','feedback'])('uses the preserved approved legacy template for an unlinked %s student', async kind => {
    const env = config();
    expect(await studentHomeworkNotification(env, { ...input, kind })).toEqual({ templateId: `old-${kind}`, variables: { '#{token}': input.token } });
  });
  it('keeps the default member-only contract without a rollout setting', async () => {
    const env = config(); delete env.SITE_LEGACY_STUDENT_APP_ENABLED;
    expect(await studentHomeworkNotification(env, input)).toEqual({ templateId: 'new-assign', variables: { '#{학생앱주소}': 'https://tiantianchinese.com/personal/' } });
    expect(env.GAME_DB.prepare).not.toHaveBeenCalled();
  });
  it.each(['assign','feedback'])('uses the fixed member destination after verified linking for %s', async kind => {
    const notice = await studentHomeworkNotification(config([linked]), { ...input, kind });
    expect(notice).toEqual({ templateId: `new-${kind}`, variables: { '#{학생앱주소}': 'https://tiantianchinese.com/personal/' } });
    expect(JSON.stringify(notice)).not.toContain(input.token);
  });
  it('does not fall back to a code when the member template is missing', async () => {
    const env = config([linked]); delete env.KAKAO_TPL_HW_ASSIGN_MEMBER;
    expect(await studentHomeworkNotification(env, input)).toEqual({ templateId: undefined, variables: { '#{학생앱주소}': 'https://tiantianchinese.com/personal/' } });
  });
  it.each([{}, { verified_by: 'other' }, { verified_at: 'invalid' }, { status: 'suspended' }, { name: '' }, { terms_accepted_at: null }])('rejects an unverified or unavailable owner without using legacy: %j', async change => {
    const row = Object.keys(change).length ? { ...linked, ...change } : {};
    await expect(studentHomeworkNotification(config([row]), input)).rejects.toThrow('student_notice_link_unavailable');
  });
  it('rejects an ambiguous owner', async () => {
    await expect(studentHomeworkNotification(config([linked, linked]), input)).rejects.toThrow('student_notice_link_unavailable');
  });
  it.each([undefined, 'https://example.invalid', 'http://tiantian-chinese.pages.dev', 'https://tiantian-chinese.pages.dev/path'])('rejects unapproved legacy origin %s', async origin => {
    const env = config(); env.SITE_LEGACY_STUDENT_APP_ORIGIN = origin;
    await expect(studentHomeworkNotification(env, input)).rejects.toThrow('student_notice_legacy_unavailable');
  });
  it('rejects an invalid legacy code', async () => {
    await expect(studentHomeworkNotification(config(), { ...input, token: '' })).rejects.toThrow();
  });
  it('fails closed on a database exception or malformed result', async () => {
    await expect(studentHomeworkNotification(config(null), input)).rejects.toThrow();
    const env = config(); env.GAME_DB.prepare.mockImplementation(() => { throw new Error('unavailable'); });
    await expect(studentHomeworkNotification(env, input)).rejects.toThrow('unavailable');
  });
});
