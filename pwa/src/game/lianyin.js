// 연음(반3성) 감지 — 인접한 3성+2성 위치를 찾는다.
// 하늘쌤 강조 규칙: 3성 뒤에 2성이 오면 앞 3성을 '반만' 내렸다가(반3성) 끊지 않고
// 뒤 2성의 상승으로 이어서 발음한다. 병음은 성조 원형(citation)을 표기하므로
// tones 배열에 [3,2]가 연속이면 곧 이 연음 케이스(3+3은 표기상 [3,3]이라 자동 제외).
//
// 반환: 첫 3성의 인덱스 i (i와 i+1이 연음 쌍). 없으면 -1.
// 순수 함수 — 표시(각인)용이라 채점에는 관여하지 않는다.
export function findLianyin(tones) {
  if (!Array.isArray(tones)) return -1;
  for (let i = 0; i < tones.length - 1; i++) {
    if (tones[i] === 3 && tones[i + 1] === 2) return i;
  }
  return -1;
}
