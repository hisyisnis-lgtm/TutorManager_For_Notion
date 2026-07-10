// 성조 그리기 판별 — 손가락/마우스로 그린 획(points)을 성조 1~4로 분류.
// '그려서 답하기' 문제 형식(듣기처럼 라운드에 드물게 섞임)의 입력 판별기.
// 판별 결과는 기존 handleTone(성조번호)로 그대로 투입 → 채점·콤보·숙련도 로직 재사용.
//
// 좌표계: 화면 좌표(y는 아래로 증가). 음높이(pitch)는 위로 갈수록 높음 → u = -y 로 뒤집어 계산.
// 성조 곡선(ToneMark 정답 모양과 동일 기준):
//   1성 = 평평(수평선) · 2성 = 상승(╱) · 3성 = 골짜기(V, 내렸다 오름) · 4성 = 하강(╲)
// 경성(0)은 '점'이라 획으로 그릴 수 없음 → 그리기 문제는 경성 없는 단어만 출제(rollDraw에서 필터).

// 판별 파라미터(튜닝 여지). 픽셀 기준 최소 크기는 패드 크기(≈300px)에 맞춘 값.
const MIN_POINTS = 4;
const MIN_EXTENT = 16;    // bbox 최장변이 이보다 작으면 '탭'으로 보고 미판정(null)
const FLAT_RATIO = 0.22;  // 세로범위 R < 가로범위 W * 이 값 → 평평(1성)
const NET_DELTA = 0.34;   // 정규화 끝점차(0~1)가 이보다 크면 상승/하강 확정
const DIP_END_MIN = 0.33; // 골짜기(3성): 양 끝이 최저점 대비 이만큼 위(정규화)일 것
const DIP_INNER = [0.18, 0.82]; // 최저점이 획의 이 구간(진행률) 안에 있어야 골짜기

// 앞/뒤 15% 구간 평균으로 끝점을 안정화(노이즈·손떨림 완화).
function endAvg(vals, head) {
  const n = vals.length;
  const k = Math.max(1, Math.round(n * 0.15));
  let sum = 0;
  for (let i = 0; i < k; i++) sum += head ? vals[i] : vals[n - 1 - i];
  return sum / k;
}

// points: [{x, y}, ...] (그린 순서 = 시간 진행). 반환: 1|2|3|4 또는 null(획으로 못 봄).
export function classifyStroke(points) {
  if (!Array.isArray(points) || points.length < MIN_POINTS) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const us = ys.map((y) => -y); // pitch: 위=큰 값
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const uMin = Math.min(...us), uMax = Math.max(...us);
  const W = xMax - xMin;       // 가로 폭
  const R = uMax - uMin;       // 세로(음높이) 범위
  if (Math.max(W, R) < MIN_EXTENT) return null; // 너무 작음 = 탭

  // 평평(1성): 세로 움직임이 가로 대비 작음. (음높이 절대위치는 안 봄 — 힌트 없음)
  if (R < W * FLAT_RATIO) return 1;

  // 정규화(0=최저, 1=최고) 후 끝점·최저점 위치로 모양 판정.
  const sNorm = (endAvg(us, true) - uMin) / R;
  const eNorm = (endAvg(us, false) - uMin) / R;
  // 최저점의 진행률(획 순서상 어디서 가장 낮았나)
  let minIdx = 0;
  for (let i = 1; i < us.length; i++) if (us[i] < us[minIdx]) minIdx = i;
  const minFrac = minIdx / (us.length - 1);

  // 골짜기(3성): 최저점이 가운데 구간 + 양 끝이 그보다 확실히 위.
  if (minFrac > DIP_INNER[0] && minFrac < DIP_INNER[1] && sNorm > DIP_END_MIN && eNorm > DIP_END_MIN) {
    return 3;
  }

  const delta = eNorm - sNorm; // 순 상승(+)/하강(-)
  if (delta > NET_DELTA) return 2;   // 상승
  if (delta < -NET_DELTA) return 4;  // 하강

  // 애매하면 끝점 방향으로 근사(그래도 평평에 가까우면 1성).
  if (delta > 0.12) return 2;
  if (delta < -0.12) return 4;
  return 1;
}
