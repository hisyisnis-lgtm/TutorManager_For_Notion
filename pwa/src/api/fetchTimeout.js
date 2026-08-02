// 공용 타임아웃 fetch — 응답 없는 요청이 무한 스피너로 남지 않게 중단한다.
// notionClient(강사)·bookingApi/homework(학생)와 동일한 25초 정책의 단일 출처.
// 파일 업로드는 대용량(최대 20MB)이라 별도의 긴 타임아웃(UPLOAD_TIMEOUT_MS)을 쓴다.

export const REQUEST_TIMEOUT_MS = 25000;
export const UPLOAD_TIMEOUT_MS = 120000;

/**
 * 일시적 실패만 지수 백오프로 재시도한다.
 *
 * 재시도 대상: 네트워크 끊김·타임아웃(에러에 status 없음)과 서버 일시 오류(5xx).
 * 재시도 제외: 4xx — 파일이 크거나(413) 형식이 안 맞거나(415) 권한이 없으면 다시 보내도
 * 결과가 같다. 재시도하면 학생을 몇 배 더 기다리게 만들 뿐이다.
 *
 * 호출부는 실패 시 `err.status`에 HTTP 상태를 실어줘야 이 판단이 동작한다(api/homework.js 참고).
 */
export async function retryTransient(fn, { attempts = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.status;
      const retryable = status == null || status >= 500;
      if (!retryable || i === attempts - 1) throw e;
      await new Promise((r) => { setTimeout(r, baseDelayMs * (i + 1)); });
    }
  }
  throw lastErr;
}

export async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('요청 시간이 초과됐어요. 네트워크를 확인하고 잠시 후 다시 시도해주세요.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
