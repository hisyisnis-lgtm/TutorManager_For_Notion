/**
 * Notion 속성값에 포함된 이모지(🟢🔴⚫⚠️📍 등)를 제거.
 * UI 표시 전에 Notion select/status/title 값을 정규화할 때 사용.
 */
export function stripEmoji(str) {
  return (str || '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '')
    .trim();
}
