import { makeNotion } from './notion.js';
import { queryStudentTimePages } from './studentLedger.js';
import { NotionPageIdSchema, StudentTokenSchema } from './schemas.js';
import { rateLimitCheck } from './securityStore.js';
import { getPandaProfile, performPandaAction } from './pandaDb.js';
import { PandaActionSchema, pandaError } from './pandaRules.js';
import catalog from '../../03_data/panda/wardrobe.json';

const upstreamError = cause => Object.assign(pandaError('earnings_unavailable', '먹이 지급 내역을 모두 확인하지 못했어요. 기존 기록은 유지됩니다.', 502), { cause });
// Never log raw exceptions: Notion/D1 messages can contain URLs, IDs and record data.
function logPandaFailure(error, operation) {
  const cause = error.cause || error;
  const message = typeof cause.message === 'string' ? cause.message : '';
  const notionStatus = cause.upstreamStatus || Number(message.match(/^Notion (\d{3})\b/)?.[1]);
  const storageReason = /no such (?:table|column)/i.test(message) ? 'schema_missing'
    : /constraint/i.test(message) ? 'constraint' : /busy|locked/i.test(message) ? 'busy' : 'unavailable';
  console.error(JSON.stringify({ event: 'panda_failure', operation,
    code: error.code === 'earnings_unavailable' ? error.code : error.code === 'invalid_saved_profile' ? error.code : 'storage_unavailable',
    reason: operation === 'earnings' ? (notionStatus ? 'notion_http' : /^Notion 연결 실패/.test(message) ? 'notion_network' : 'invalid_earnings') : storageReason,
    ...(Number.isInteger(notionStatus) && notionStatus >= 100 && notionStatus <= 599 ? { upstreamStatus: notionStatus } : {}),
  }));
}
const foodCount = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw upstreamError();
  return value;
};

export function computePandaEarnings(properties, classes, now = Date.now()) {
  if (!properties || !Object.hasOwn(properties, '공유일') || !Object.hasOwn(properties['공유일'], 'date')) throw upstreamError();
  const sharedAt = properties['공유일'].date?.start;
  if (properties['공유일'].date === null) return 0;
  const shared = Date.parse(sharedAt);
  if (!Number.isFinite(shared)) throw upstreamError();
  const homework = foodCount(properties['숙제 제출 먹이']?.rollup?.number)
    + foodCount(properties['피드백 확인 먹이']?.rollup?.number);
  let minutes = 0;
  for (const page of classes) {
    const props = page.properties;
    if (!props || !Object.hasOwn(props, '특이사항') || !Object.hasOwn(props['특이사항'], 'select')) throw upstreamError();
    const special = props['특이사항'].select?.name;
    if (special === '🚫 취소' || special === '🟠 보강') continue;
    const paid = props['무료 수업']?.rollup?.number;
    if (typeof paid !== 'number' || !Number.isFinite(paid) || paid < 0) throw upstreamError();
    if (paid === 0) continue;
    const date = Date.parse(props['수업 일시']?.date?.start);
    if (!Number.isFinite(date)) throw upstreamError();
    if (date < shared || date > now) continue;
    const duration = parseInt(props['수업 시간(분)']?.select?.name, 10);
    if (!Number.isSafeInteger(duration) || duration <= 0) throw upstreamError();
    minutes += duration;
  }
  return foodCount(Math.floor(minutes / catalog.economy.minutesPerFood) + homework);
}

async function loadEarnings(env, token, { studentDbId, classDbId }) {
  const callNotion = makeNotion(env.NOTION_TOKEN);
  const notion = async (...args) => {
    const result = await callNotion(...args);
    if (result?.object === 'error') throw Object.assign(new Error('Notion request rejected'), { upstreamStatus: result.status });
    return result;
  };
  const result = await notion('POST', `/databases/${studentDbId}/query`, {
    filter: { property: '예약 코드', rich_text: { equals: token } }, page_size: 2,
  });
  if (!Array.isArray(result?.results) || result.has_more !== false || result.results.length > 1) throw upstreamError();
  const student = result.results[0];
  if (!student) throw pandaError('student_not_found', '등록된 학생이 아닙니다.', 404);
  if (!NotionPageIdSchema.safeParse(student.id).success) throw upstreamError();
  const classes = await queryStudentTimePages(notion, classDbId, student.id);
  return { studentId: student.id.replaceAll('-', '').toLowerCase(), earnedTotal: computePandaEarnings(student.properties, classes) };
}

export async function handlePandaRoutes(request, env, corsHeaders, { token, actionRoute, authorizeStudent, studentDbId, classDbId }) {
  const headers = { ...corsHeaders, 'Cache-Control': 'private, no-store' };
  const reply = (body, status = 200) => Response.json(body, { status, headers });
  if (request.method !== (actionRoute ? 'POST' : 'GET')) return reply({ error: '지원하지 않는 요청입니다.' }, 405);
  if (!StudentTokenSchema.safeParse(token).success) return reply({ error: '학생 코드를 확인해 주세요.' }, 400);
  const denied = await authorizeStudent(request, env, headers, token, 'personal/student/panda');
  if (denied) return denied;
  if (!(await rateLimitCheck(env, `panda:${token}`, 120, 60))) return reply({ error: '잠시 후 다시 시도해 주세요.', code: 'rate_limited' }, 429);
  let action;
  if (actionRoute) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 8192) return reply({ error: '요청이 너무 큽니다.' }, 413);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
    const parsed = PandaActionSchema.safeParse(body);
    if (!parsed.success) return reply({ error: '요청 형식이 올바르지 않습니다.', code: 'invalid_action' }, 400);
    action = parsed.data;
  }
  let operation = 'earnings';
  try {
    let identity;
    try { identity = await loadEarnings(env, token, { studentDbId, classDbId }); }
    catch (error) { if (error.status === 404) throw error; throw upstreamError(error); }
    operation = actionRoute ? 'action' : 'read';
    const result = actionRoute
      ? await performPandaAction(env.GAME_DB, identity.studentId, identity.earnedTotal, action)
      : await getPandaProfile(env.GAME_DB, identity.studentId, identity.earnedTotal);
    return reply(result);
  } catch (error) {
    if (!error.status || error.status >= 500 || error.code === 'invalid_saved_profile') logPandaFailure(error, operation);
    if (error.status) return reply({ error: error.message, code: error.code,
      ...(error.profile ? { profile: error.profile, earnedTotal: error.earnedTotal,
        availableFood: error.availableFood, transition: error.transition } : {}) }, error.status);
    return reply({ error: '판다 기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', code: 'storage_unavailable' }, 503);
  }
}
