/** Cloudflare Worker URL — 단일 출처 정의, 모든 API 파일에서 여기서 import */
export const WORKER_URL = import.meta.env.VITE_WORKER_URL;

if (!WORKER_URL) {
  console.warn('[config] VITE_WORKER_URL이 설정되지 않았습니다. .env.local 파일을 확인하세요.');
}
