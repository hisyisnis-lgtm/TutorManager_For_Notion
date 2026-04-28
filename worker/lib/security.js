// 보안 유틸 — 순수 함수 (외부 의존성 없음, 테스트 가능)

/**
 * SSRF 방어. og-proxy류에서 사용자가 보낸 URL을 fetch하기 전에 호출.
 * 내부망/메타데이터/loopback으로의 우회 호출을 차단한다.
 *
 * DNS rebinding까지 막으려면 추가 작업 필요하지만 이건 1차 방어선.
 *
 * @param {string} rawUrl - 검사할 URL 문자열
 * @returns {boolean} - 외부 fetch에 안전하면 true
 */
export function isSafeExternalUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;

  const host = u.hostname.toLowerCase();
  // 명백한 사설/메타데이터 호스트
  const PRIVATE_HOST_PATTERNS = [
    /^localhost$/,
    /\.local$/,
    /\.internal$/,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,         // link-local + AWS/GCP 메타데이터
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
    /^0\./,
    /^::1$/,
    /^fe80:/i,
    /^fc00:/i, /^fd[0-9a-f]{2}:/i, // IPv6 ULA
  ];
  if (PRIVATE_HOST_PATTERNS.some(re => re.test(host))) return false;

  // IP 직접 표기는 일반 콘텐츠 미리보기에 필요 없으므로 호스트명만 허용
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (host.includes(':')) return false; // IPv6 리터럴

  return true;
}

/**
 * 전화번호 PII 마스킹.
 * 끝 4자리만 보존하고 앞 부분은 별표 처리.
 * 예: "010-1234-5678" → "***-****-5678", "01012345678" → "***-****-5678"
 *
 * ntfy 알림·로그 등에서 PII 노출 방지.
 */
export function maskPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-****-${digits.slice(-4)}`;
}

/**
 * 학생 토큰/예약 코드 마스킹.
 * 양 끝 4자만 노출, 중간은 점 3개로 가림.
 * 예: "ABCD1234EFGH5678" → "ABCD...5678"
 *
 * 8자 이하면 안전상 전체 마스킹 ("***" 반환).
 */
export function maskToken(token) {
  const t = String(token || '');
  if (t.length <= 8) return '***';
  return `${t.slice(0, 4)}...${t.slice(-4)}`;
}
