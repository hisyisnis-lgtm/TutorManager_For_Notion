// 공용 타임아웃 fetch — 응답 없는 요청이 무한 스피너로 남지 않게 중단한다.
// notionClient(강사)·bookingApi/homework(학생)와 동일한 25초 정책의 단일 출처.
// 파일 업로드는 대용량(최대 20MB)이라 별도의 긴 타임아웃(UPLOAD_TIMEOUT_MS)을 쓴다.

export const REQUEST_TIMEOUT_MS = 25000;
export const UPLOAD_TIMEOUT_MS = 120000;

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
