import publicTerms from '../../03_data/consent/terms.json' with { type: 'json' };
import { StudentTokenSchema } from './schemas.js';

// 공개 조항은 공식 사이트와 공유하고, 확인 양식 주소는 인증 API에만 유지한다.
const terms = {
  ...publicTerms,
  confirmationUrl: 'https://forms.gle/GSrU2jruYTuFQxwo8',
};

export async function handleConsentTerms(request, env, corsHeaders, { token, authorizeStudent, authorizeTeacher }) {
  const headers = { ...corsHeaders, 'Cache-Control': 'private, no-store' };
  if (request.method !== 'GET') return Response.json({ error: '지원하지 않는 요청입니다.' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
  if (token !== undefined && !StudentTokenSchema.safeParse(token).success) return Response.json({ error: '학생 코드를 확인해 주세요.' }, { status: 400, headers });
  const denied = token === undefined
    ? await authorizeTeacher(request, env, headers)
    : await authorizeStudent(request, env, headers, token, 'booking/consent');
  if (denied) return denied;
  return Response.json(terms, { headers });
}
