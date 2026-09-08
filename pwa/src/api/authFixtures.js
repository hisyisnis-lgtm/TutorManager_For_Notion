// 보안 회귀 테스트 전용 합성 payload. 실제 서버에서는 서명이 없어 인증되지 않는다.
export function fixtureSession(purpose = 'teacher', subject, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    v: 2, iss: 'tutor-manager', aud: `tutor-manager:${purpose}`, purpose,
    sub: subject || (purpose === 'teacher' ? 'teacher' : 'personal:STUDENT_A'),
    ...(purpose === 'teacher' ? { role: 'teacher' } : {}),
    iat: now, exp: now + 3600, ...overrides,
  };
  return `${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.fixture-signature`;
}
