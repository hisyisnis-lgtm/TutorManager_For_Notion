import { describe, it, expect } from 'vitest';
import {
  recordWordResult, accuracy, avgMs, isMastered, needsReview, noteLeft,
  buildReviewList, masteredCount, subsetForPool, mergeStats, buildRoundWords,
  MASTER_MIN_ATTEMPTS, MASTER_ACCURACY, MASTER_EXIT_ACCURACY, NOTE_TARGET,
} from './tgWordStats.js';

// entry = [attempts, perfect, totalCompletedMs, completedCount, mastered(0/1), noteLeft(0~3)]

describe('recordWordResult — 결과 1건 반영', () => {
  it('새 단어는 [1, perfect, ms, completed, 플래그, 노트]로 시작', () => {
    const s = {};
    recordWordResult(s, '老师', { perfect: true, timedOut: false, ms: 3000 });
    expect(s['老师']).toEqual([1, 1, 3000, 1, 0, 0]); // 시도 1 < 2 → 아직 미마스터 · 한 번에 맞혀 노트 밖
  });

  it('무실수 아님은 perfect 증가 안 함', () => {
    const s = {};
    recordWordResult(s, '你好', { perfect: false, timedOut: false, ms: 5000 });
    expect(s['你好']).toEqual([1, 0, 5000, 1, 0, 3]); // 틀림 → 오답 노트 등록
  });

  it('시간초과는 시도만 늘고 완료시간/완료수에 미반영', () => {
    const s = {};
    recordWordResult(s, '谢谢', { perfect: false, timedOut: true, ms: 0 });
    expect(s['谢谢']).toEqual([1, 0, 0, 0, 0, 3]);
  });

  it('누적된다', () => {
    const s = {};
    recordWordResult(s, '妈妈', { perfect: true, timedOut: false, ms: 2000 });
    recordWordResult(s, '妈妈', { perfect: false, timedOut: false, ms: 4000 });
    expect(s['妈妈']).toEqual([2, 1, 6000, 2, 0, 3]); // 50% < 80% → 미마스터
  });

  it('음수 ms는 0으로 클램프하고 반올림', () => {
    const s = {};
    recordWordResult(s, '朋友', { perfect: true, timedOut: false, ms: -50 });
    recordWordResult(s, '朋友', { perfect: true, timedOut: false, ms: 1499.6 });
    expect(s['朋友']).toEqual([2, 2, 1500, 2, 1, 0]); // 2회 100% → 마스터 진입
  });
});

describe('★오답 노트 카운터 — 1번 틀리면 등록, 정답 3번(비연속)이면 졸업', () => {
  const play = (s, hz, perfect) => recordWordResult(s, hz, { perfect, timedOut: false, ms: 3000 });
  const left = (s, hz) => noteLeft(s[hz]);

  it('졸업 목표는 3회', () => {
    expect(NOTE_TARGET).toBe(3);
  });

  it('한 번도 안 틀리면 노트에 안 올라온다', () => {
    const s = {};
    play(s, 'A', true); play(s, 'A', true);
    expect(left(s, 'A')).toBe(0);
    expect(needsReview(s.A)).toBe(false);
  });

  it('1번 틀리면 등록(남은 3) — 시간초과·정답보기 등 perfect 아닌 결과 전부', () => {
    const s = {};
    play(s, 'A', false);
    expect(left(s, 'A')).toBe(3);
    expect(needsReview(s.A)).toBe(true);
  });

  it('정답 3번이면 사라진다 — 연속일 필요 없음(사이에 다른 단어를 틀려도 무관)', () => {
    const s = {};
    play(s, 'A', false);              // 등록
    play(s, 'A', true); expect(left(s, 'A')).toBe(2);
    play(s, 'B', false);              // 다른 단어 오답 — A에 영향 없음
    play(s, 'A', true); expect(left(s, 'A')).toBe(1);
    play(s, 'A', true);
    expect(left(s, 'A')).toBe(0);     // 졸업
    expect(needsReview(s.A)).toBe(false);
  });

  it('정답률이 낮아도 3번만 맞히면 졸업한다(구 규칙과의 핵심 차이)', () => {
    const s = {};
    for (let i = 0; i < 10; i++) play(s, 'A', false); // 정답률 0%, 남은 3
    play(s, 'A', true); play(s, 'A', true); play(s, 'A', true);
    expect(accuracy(s.A)).toBeLessThan(MASTER_ACCURACY); // 23% — 구 규칙이면 영영 못 나감
    expect(left(s, 'A')).toBe(0);
  });

  it('노트 안에서 또 틀리면 리셋이 아니라 한 칸 후퇴(+1, 최대 3)', () => {
    const s = {};
    play(s, 'A', false);                                  // 3
    play(s, 'A', true); play(s, 'A', true);               // 1 — 졸업 직전
    play(s, 'A', false);
    expect(left(s, 'A')).toBe(2);                          // 리셋(3)이 아니라 2
    play(s, 'A', false); expect(left(s, 'A')).toBe(3);
    play(s, 'A', false); expect(left(s, 'A')).toBe(3);     // 3에서 더 늘지 않음
  });

  it('졸업 후 다시 틀리면 신규 등록(3부터)', () => {
    const s = {};
    play(s, 'A', false);
    play(s, 'A', true); play(s, 'A', true); play(s, 'A', true); // 졸업
    play(s, 'A', false);
    expect(left(s, 'A')).toBe(3);
  });

  it('노트 밖 단어를 맞혀도 음수로 내려가지 않는다', () => {
    const s = {};
    for (let i = 0; i < 5; i++) play(s, 'A', true);
    expect(left(s, 'A')).toBe(0);
  });

  it('레거시 엔트리(카운터 없음)는 구 규칙으로 시드 — 떠 있던 노트가 사라지지 않게', () => {
    expect(noteLeft([4, 1, 0, 0])).toBe(3);       // 25% → 노트에 있던 단어
    expect(noteLeft([5, 4, 0, 0])).toBe(0);       // 80% → 노트 밖
    expect(noteLeft([0, 0, 0, 0])).toBe(0);       // 미시도
    expect(noteLeft(undefined)).toBe(0);
  });

  it('레거시 단어도 이어서 정답 3번이면 졸업', () => {
    const s = { A: [4, 1, 0, 0] }; // 시드 3
    play(s, 'A', true); play(s, 'A', true); play(s, 'A', true);
    expect(left(s, 'A')).toBe(0);
  });
});

describe('★마스터 히스테리시스 — 진입 ≥80%, 해제 <60% (등급 강등의 완충)', () => {
  const play = (s, hz, perfect) => recordWordResult(s, hz, { perfect, timedOut: false, ms: 3000 });
  it('상수: 진입 0.8 / 해제 0.6', () => {
    expect(MASTER_ACCURACY).toBe(0.8);
    expect(MASTER_EXIT_ACCURACY).toBe(0.6);
  });
  it('60~80% 구간에선 마스터 유지(경계 요요 방지)', () => {
    const s = {};
    for (let i = 0; i < 4; i++) play(s, 'A', true); // 4/4 → 마스터
    expect(isMastered(s.A)).toBe(true);
    play(s, 'A', false); // 4/5 = 80%
    play(s, 'A', false); // 4/6 ≈ 67% — 예전 규칙(<80% 즉시 해제)이면 여기서 강등됐을 것
    expect(isMastered(s.A)).toBe(true); // 히스테리시스로 유지
  });
  it('60% 미만으로 떨어지면 해제(진짜 무너진 단어만)', () => {
    const s = {};
    for (let i = 0; i < 4; i++) play(s, 'A', true);
    for (let i = 0; i < 3; i++) play(s, 'A', false); // 4/7 ≈ 57% < 60%
    expect(isMastered(s.A)).toBe(false);
  });
  it('해제 후 재진입은 다시 ≥80% 필요', () => {
    const s = {};
    for (let i = 0; i < 4; i++) play(s, 'A', true);
    for (let i = 0; i < 3; i++) play(s, 'A', false); // 해제(57%)
    play(s, 'A', true); // 5/8 = 62.5% — 60~80% 구간이지만 이미 해제 상태 → 미마스터 유지
    expect(isMastered(s.A)).toBe(false);
  });
  it('레거시 4튜플은 첫 기록 때 기존 규칙으로 시드 후 히스테리시스 적용', () => {
    const s = { A: [5, 4, 0, 0] }; // 레거시 80% = 마스터였던 단어
    play(s, 'A', false); // 4/6 ≈ 67% — 시드(마스터) 후 히스테리시스 → 유지
    expect(s.A.length).toBe(6);
    expect(isMastered(s.A)).toBe(true);
  });
});

describe('accuracy / avgMs', () => {
  it('accuracy = perfect / attempts (시도 0이면 0)', () => {
    expect(accuracy([4, 3, 0, 0])).toBe(0.75);
    expect(accuracy([0, 0, 0, 0])).toBe(0);
    expect(accuracy(undefined)).toBe(0);
  });

  it('avgMs = totalMs / completedCount (완료 0이면 0)', () => {
    expect(avgMs([3, 2, 6000, 2])).toBe(3000);
    expect(avgMs([1, 0, 0, 0])).toBe(0);
  });
});

describe('isMastered / needsReview', () => {
  it('마스터 = 시도 2+ & 정답률 80%+', () => {
    expect(isMastered([2, 2, 4000, 2])).toBe(true);      // 100%
    expect(isMastered([5, 4, 0, 0])).toBe(true);          // 80%
    expect(isMastered([1, 1, 1000, 1])).toBe(false);      // 시도 1회 — 우연 방지
    expect(isMastered([5, 3, 0, 0])).toBe(false);         // 60%
  });

  it('마스터 임계 상수가 기대값', () => {
    expect(MASTER_MIN_ATTEMPTS).toBe(2);
    expect(MASTER_ACCURACY).toBe(0.8);
  });

  it('복습필요 = 오답 노트 등록 상태(남은 정답 횟수 > 0)', () => {
    expect(needsReview([3, 1, 0, 0, 0, 2])).toBe(true);   // 노트 안(2번 남음)
    expect(needsReview([3, 1, 0, 0, 0, 0])).toBe(false);  // 정답률 33%여도 졸업했으면 제외
    expect(needsReview([2, 2, 0, 0])).toBe(false);        // 레거시 100% → 시드 0
    expect(needsReview([0, 0, 0, 0])).toBe(false);        // 미시도
  });
});

describe('buildReviewList — 갈 길 먼 순 정렬', () => {
  const wordMap = {
    A: { hanzi: 'A', meaning: 'a' },
    B: { hanzi: 'B', meaning: 'b' },
    C: { hanzi: 'C', meaning: 'c' },
  };

  it('복습필요 단어만, 정답률 낮은 순으로', () => {
    const stats = {
      A: [4, 1, 8000, 2], // 25%
      B: [4, 3, 8000, 4], // 75% (둘 다 80% 미만)
      C: [2, 2, 4000, 2], // 100% — 제외(마스터)
    };
    const rows = buildReviewList(stats, wordMap);
    expect(rows.map((r) => r.word.hanzi)).toEqual(['A', 'B']);
    expect(rows[0].acc).toBeLessThan(rows[1].acc);
  });

  it('동률이면 평균속도 느린 순', () => {
    const stats = {
      A: [4, 2, 2000, 1], // 50%, avg 2000
      B: [4, 2, 8000, 1], // 50%, avg 8000 — 더 느림 → 먼저
    };
    const rows = buildReviewList(stats, wordMap);
    expect(rows[0].word.hanzi).toBe('B');
  });

  it('풀에 없는(삭제된) 단어는 제외', () => {
    const stats = { Z: [3, 0, 0, 0] };
    expect(buildReviewList(stats, wordMap)).toEqual([]);
  });

  it('남은 정답 횟수가 많은 단어(갈 길 먼 쪽)가 위로 · 졸업 단어는 빠진다', () => {
    const stats = {
      A: [6, 5, 0, 0, 0, 1], // 정답률 83%지만 아직 1번 남음
      B: [6, 1, 0, 0, 0, 3], // 3번 남음 → 위
      C: [6, 1, 0, 0, 0, 0], // 정답률 17%여도 졸업 → 제외
    };
    const rows = buildReviewList(stats, wordMap);
    expect(rows.map((r) => r.word.hanzi)).toEqual(['B', 'A']);
    expect(rows.map((r) => r.left)).toEqual([3, 1]);
  });
});

describe('masteredCount', () => {
  it('맵에 있고 마스터인 단어만 카운트', () => {
    const wordMap = { A: { hanzi: 'A' }, B: { hanzi: 'B' } };
    const stats = { A: [3, 3, 0, 0], B: [3, 1, 0, 0], Z: [9, 9, 0, 0] };
    expect(masteredCount(stats, wordMap)).toBe(1); // A만(Z는 맵에 없음)
  });
});

describe('subsetForPool — 풀 단어 통계만 추림', () => {
  it('풀에 있는 단어 통계만 반환', () => {
    const stats = { 老师: [1, 1, 0, 0], 你好: [2, 2, 0, 0] };
    const pool = [{ hanzi: '老师' }];
    expect(subsetForPool(stats, pool)).toEqual({ 老师: [1, 1, 0, 0] });
  });

  it('빈 풀/널은 빈 객체', () => {
    expect(subsetForPool({ a: [1, 0, 0, 0] }, [])).toEqual({});
    expect(subsetForPool({ a: [1, 0, 0, 0] }, null)).toEqual({});
  });
});

describe('mergeStats — 시도수 많은 쪽 채택 · 노트는 더 진행된 쪽', () => {
  it('incoming의 attempts가 더 많으면 덮어쓴다', () => {
    const base = { A: [2, 1, 0, 0, 0, 3] };
    const incoming = { A: [5, 3, 0, 0, 0, 3] };
    expect(mergeStats(base, incoming).A).toEqual([5, 3, 0, 0, 0, 3]);
  });

  it('base의 attempts가 더 많으면 유지', () => {
    const base = { A: [9, 5, 0, 0, 0, 2] };
    const incoming = { A: [3, 3, 0, 0, 0, 2] };
    expect(mergeStats(base, incoming).A).toEqual([9, 5, 0, 0, 0, 2]);
  });

  it('노트 진행은 더 많이 한 쪽(남은 횟수가 작은 쪽)을 살린다 — 다른 기기 졸업이 되살아나지 않게', () => {
    const base = { A: [9, 5, 0, 0, 0, 3] };      // 시도 많지만 노트 그대로
    const incoming = { A: [3, 3, 0, 0, 0, 0] };  // 다른 기기에서 졸업시킴
    expect(mergeStats(base, incoming).A[5]).toBe(0);
    expect(mergeStats(base, incoming).A[0]).toBe(9); // 나머지 수치는 시도 많은 쪽
  });

  it('레거시 4튜플끼리 병합해도 구멍(hole) 없이 6칸이 된다', () => {
    const merged = mergeStats({ A: [4, 1, 0, 0] }, { A: [6, 2, 0, 0] }).A;
    expect(merged).toEqual([6, 2, 0, 0, 0, 3]); // 33% → 마스터 0 · 노트 시드 3
  });

  it('base에 없는 단어는 추가', () => {
    expect(mergeStats({}, { B: [1, 1, 0, 0] }).B).toEqual([1, 1, 0, 0]);
  });

  it('배열 아닌 incoming 값은 무시', () => {
    expect(mergeStats({}, { B: 'garbage' })).toEqual({});
  });

  it('원본 base를 변형하지 않는다', () => {
    const base = { A: [2, 1, 0, 0] };
    mergeStats(base, { A: [5, 3, 0, 0] });
    expect(base.A).toEqual([2, 1, 0, 0]);
  });

  it('배열 아닌 base 값은 incoming으로 교체(손상 엔트리 방어)', () => {
    expect(mergeStats({ A: 'garbage' }, { A: [2, 1, 0, 0] }).A).toEqual([2, 1, 0, 0]);
  });
});

describe('buildRoundWords — 약점가중 비복원 추첨', () => {
  const w = (hanzi) => ({ hanzi, pinyin: [], tones: [], meaning: '' });
  const pool6 = ['A', 'B', 'C', 'D', 'E', 'F'].map(w);

  it('풀 크기 ≤ n이면 전부 반환(같은 멀티셋)', () => {
    const out = buildRoundWords(pool6, {}, 6);
    expect(out).toHaveLength(6);
    expect(out.map((x) => x.hanzi).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const out2 = buildRoundWords(pool6, {}, 10); // n이 더 커도 전부
    expect(out2).toHaveLength(6);
  });

  it('풀 > n이면 정확히 n개, 중복 없음(비복원)', () => {
    const out = buildRoundWords(pool6, {}, 3);
    expect(out).toHaveLength(3);
    const hz = out.map((x) => x.hanzi);
    expect(new Set(hz).size).toBe(3); // 중복 없음
    for (const h of hz) expect(['A', 'B', 'C', 'D', 'E', 'F']).toContain(h); // 풀 안에서만
  });

  it('빈 풀/널은 빈 배열', () => {
    expect(buildRoundWords([], {}, 3)).toEqual([]);
    expect(buildRoundWords(null, {}, 3)).toEqual([]);
  });

  it('약점 단어가 마스터 단어보다 자주 뽑힌다(가중 3.0 vs 1.0)', () => {
    // weakA=정답률20%(needsReview→3.0), masterB=정답률100%·시도4(isMastered→1.0), 나머지 신규(2.5)
    const stats = { weakA: [5, 1, 0, 0], masterB: [4, 4, 4000, 4] };
    const pool = ['weakA', 'masterB', 'n1', 'n2', 'n3', 'n4'].map(w);
    let weak = 0, master = 0;
    const ROUNDS = 3000;
    for (let i = 0; i < ROUNDS; i++) {
      const picked = buildRoundWords(pool, stats, 3).map((x) => x.hanzi);
      if (picked.includes('weakA')) weak += 1;
      if (picked.includes('masterB')) master += 1;
    }
    expect(weak).toBeGreaterThan(master * 1.5); // 약점이 확연히 더 자주
    expect(master).toBeGreaterThan(0);           // 마스터도 영구 제외 아님(망각 방지)
  });

  it('첫 플레이(통계 0)는 전부 신규=거의 균등 노출', () => {
    // 통계 없으면 모든 단어 weight 2.5 → 6개에서 3개 뽑기를 반복하면 각 단어 등장 빈도가 비슷
    const counts = Object.fromEntries(pool6.map((x) => [x.hanzi, 0]));
    const ROUNDS = 3000;
    for (let i = 0; i < ROUNDS; i++) {
      for (const x of buildRoundWords(pool6, {}, 3)) counts[x.hanzi] += 1;
    }
    const vals = Object.values(counts);
    const min = Math.min(...vals), max = Math.max(...vals);
    // 이상적 균등은 각 1500회(3000*3/6). 균등이면 편차가 작다 — max/min < 1.25면 충분히 균등.
    expect(max / min).toBeLessThan(1.25);
  });
});
