// 작성 내용 자체는 보관하지 않는다. SW 업데이트가 메모리의 편집 상태를 지우지 않게
// 현재 화면의 보호 여부만 추적하며 언마운트·저장 완료 시 즉시 해제한다.
const pendingForms = new Set();

export function setUnsavedChanges(owner, pending) {
  if (pending) pendingForms.add(owner);
  else pendingForms.delete(owner);
}

export function hasUnsavedChanges() {
  return pendingForms.size > 0;
}
