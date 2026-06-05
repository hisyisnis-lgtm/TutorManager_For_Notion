// 문자열 유틸 — 순수 함수 (외부 의존성 없음, 테스트 가능)

/**
 * 학생 이름 앞에 붙는 Notion 상태 이모지·심볼을 제거.
 * 예: "🟢 김학생" → "김학생", "◆ 이학생" → "이학생"
 *
 * 운영용 카카오톡 알림 발송 시 학생 이름이 깨끗해야 함.
 */
export function stripEmoji(name) {
  return String(name ?? '').replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}◆◇▲▽△▼●○■□★☆♦♢]\s*/gu, '').trim();
}

/**
 * Notion ID 정규화 — 하이픈 제거.
 * Notion 웹훅은 하이픈 없이 ID를 보낼 수 있어서 일관된 형식으로 변환.
 * 예: "314838fa-f2a6-8143-a6c7-e59c50f3bbdb" → "314838faf2a68143a6c7e59c50f3bbdb"
 */
export function normalizeId(id) {
  return (id || '').replace(/-/g, '');
}

/**
 * 한국 휴대폰 번호 정규화 — 학생 DB 형식(하이픈 없는 `01012345678`)으로 통일.
 * 게임 회원(전화번호 = 단일 정체성)의 find-or-create·학생 매칭 키로 사용.
 * 다양한 입력(하이픈·공백·국가코드 +82)을 표준형으로. 유효한 휴대폰 패턴이 아니면 null.
 *   "010-1234-5678" / "+82 10 1234 5678" / "821012345678" → "01012345678"
 * @param {string} raw
 * @returns {string|null} 표준형 또는 null(유효하지 않음)
 */
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, ''); // 숫자만
  if (!d) return null;
  if (d.startsWith('82')) d = `0${d.slice(2)}`;  // 국가코드 +82 → 국내 0 prefix
  d = d.replace(/^0+/, '0');                      // 선행 0 중복(예: 82+010 → 00..) 정리
  return /^01[016789]\d{7,8}$/.test(d) ? d : null; // 010/011/016~019 + 7~8자리
}
