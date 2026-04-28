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
