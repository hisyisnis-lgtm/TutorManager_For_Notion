import { CheckIcon } from '@phosphor-icons/react';

/**
 * 목록에서 "고른 항목"을 표시하는 공용 컨트롤 — 24px 원 + 흰 체크.
 *
 * 네이티브 `<input type=checkbox|radio>`는 OS 크롬(각진 사각·시스템 렌더)이라 앱 톤과 겉돈다(§19.1).
 * 이 컴포넌트는 **표시 전용**이고, 실제 입력·키보드 접근성은 옆에 둔 감춘 `<input>`(`sr-only
 * select-check-input`)이나 부모 요소가 맡는다. 스타일·상태 전환은 index.css `.select-check`.
 *
 * 쓰는 곳: 수업 폼 학생 선택 · 결제 폼 학생 선택 · 학생별 수업 카드 다중선택.
 */
export default function SelectCheck({ selected }) {
  return (
    <span className="select-check" data-selected={selected} aria-hidden="true">
      <CheckIcon size={16} weight="bold" />
    </span>
  );
}
