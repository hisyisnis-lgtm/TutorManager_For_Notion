// zod 스키마 검증 헬퍼.
// 라우트 핸들러에서 사용:
//   const v = validateBody(ConsultSchema, body, corsHeaders);
//   if (!v.ok) return v.response;
//   const data = v.data; // 검증된 데이터

/**
 * Body 검증. 실패 시 corsHeaders 포함 400 Response 반환.
 * 성공 시 검증된 data 반환.
 */
export function validateBody(schema, body, corsHeaders) {
  return runValidation(schema, body, corsHeaders, '입력 형식이 올바르지 않습니다.');
}

/**
 * Query/Path 파라미터 검증.
 */
export function validateParams(schema, params, corsHeaders) {
  return runValidation(schema, params, corsHeaders, '요청 파라미터가 올바르지 않습니다.');
}

/**
 * 단일 path 파라미터(예: 학생 토큰) 검증.
 */
export function validatePathToken(schema, value, corsHeaders, paramName = '토큰') {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues[0]?.message || '형식 오류';
    return {
      ok: false,
      response: jsonError(`${paramName} ${detail}`, corsHeaders, 400),
    };
  }
  return { ok: true, data: result.data };
}

function runValidation(schema, input, corsHeaders, defaultMsg) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    }));
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: defaultMsg, details: issues }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ),
    };
  }
  return { ok: true, data: result.data };
}

function jsonError(message, corsHeaders, status) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
