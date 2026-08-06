// Notion API 호출 헬퍼 — 일시적 실패를 흡수하고, 끝내 실패하면 원인을 그대로 드러낸다.

// 재시도 간격. 총 3회 시도, 최악의 경우 1.1초만 더 기다린다.
// 학생이 화면 앞에서 대기하는 요청이라 더 길게 끌지 않는다.
export const NOTION_BACKOFF_MS = [300, 800];

/**
 * Notion API fetch 헬퍼 팩토리 — 토큰을 한 번만 바인딩
 * 반환된 함수: (method, path, body?) → Promise<JSON>
 *
 * 재시도·상태 코드 확인이 필요한 이유 (2026-08-06 장애):
 * api.notion.com은 Cloudflare 뒤에 있어 오리진이 흔들리면 JSON이 아니라 평문
 * 에러 페이지("error code: 525")를 반환한다. 이전 구현은 상태 코드를 보지 않고
 * 곧바로 r.json()을 호출했고, 그 결과 08:56~08:59 3분간
 *   ① 잠시 뒤 다시 시도했으면 성공했을 학생 요청이 그대로 500으로 실패했고
 *   ② 에러가 "SyntaxError: Unexpected token 'e'"로 둔갑해 알림만 보고는
 *      원인이 Notion 장애라는 걸 알 수 없었다.
 * 이제 일시적 실패는 흡수하고, 끝내 실패하면 실제 상태 코드를 담아 던진다.
 *
 * @param {string} notionToken
 * @param {{ backoffMs?: number[] }} [opts] backoffMs는 테스트에서 대기를 없애기 위한 주입점
 */
export function makeNotion(notionToken, { backoffMs = NOTION_BACKOFF_MS } = {}) {
  return async (method, path, body) => {
    for (let attempt = 0; ; attempt++) {
      const isLastAttempt = attempt >= backoffMs.length;
      let res;
      try {
        res = await fetch(`https://api.notion.com/v1${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        // 네트워크 계층 실패(연결 끊김·타임아웃) — 응답 자체가 없어 아래 상태 코드
        // 분기를 탈 수 없으므로 여기서 따로 재시도한다.
        if (isLastAttempt) {
          throw new Error(
            `Notion 연결 실패 (${method} ${path}, ${attempt + 1}회 시도): ${e.message}`
          );
        }
        await new Promise(r => setTimeout(r, backoffMs[attempt]));
        continue;
      }

      // 429(rate limit)·5xx는 잠시 뒤 성공할 가능성이 높은 일시적 실패.
      if (res.status === 429 || res.status >= 500) {
        if (!isLastAttempt) {
          await new Promise(r => setTimeout(r, backoffMs[attempt]));
          continue;
        }
        const text = await res.text().catch(() => '');
        throw new Error(
          `Notion ${res.status} (${method} ${path}, ${attempt + 1}회 시도): ${text.slice(0, 200).trim()}`
        );
      }

      // 4xx(429 제외)는 Notion이 정상 JSON 에러 객체를 돌려주고, 기존 호출부가
      // 그 형태에 의존한다(예: findStudentByToken은 results가 없으면 null 반환).
      // 그래서 여기서 던지지 않고 파싱 결과를 그대로 넘긴다.
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          `Notion ${res.status} 응답이 JSON이 아님 (${method} ${path}): ${text.slice(0, 200).trim()}`
        );
      }
    }
  };
}
