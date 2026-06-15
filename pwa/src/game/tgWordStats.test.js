import { describe, it, expect } from 'vitest';
import {
  recordWordResult, accuracy, avgMs, isMastered, needsReview,
  buildReviewList, masteredCount, subsetForPool, mergeStats, buildRoundWords,
  MASTER_MIN_ATTEMPTS, MASTER_ACCURACY,
} from './tgWordStats.js';

// entry = [attempts, perfect, totalCompletedMs, completedCount]

describe('recordWordResult — 결과 1건 반영', () => {
  it('새 단어는 [1, perfect, ms, completed]로 시작', () => {
    const s = {};
    recordWordResult(s, '老师', { perfect: true, timedOut: false, ms: 3000 });
    expect(s['老师']).toEqual([1, 1, 3000, 1]);
  });

  it('무실수 아님은 perfect 증가 안 함', () => {
    const s = {};
    recordWordResult(s, '你好', { perfect: false, timedOut: false, ms: 5000 });
    expect(s['你好']).toEqual([1, 0, 5000, 1]);
  });

  it('시간초과는 시도만 늘고 완료시간/완료수에 미반영', () => {
    const s = {};
    recordWordResult(s, '谢谢', { perfect: false, timedOut: true, ms: 0 });
    expect(s['谢谢']).toEqual([1, 0, 0, 0]);
  });

  it('누적된다', () => {
    const s = {};
    recordWordResult(s, '妈妈', { perfect: true, timedOut: false, ms: 2000 });
    recordWordResult(s, '妈妈', { perfect: false, timedOut: false, ms: 4000 });
    expect(s['妈妈']).toEqual([2, 1, 6000, 2]);
  });

  it('음수 ms는 0으로 클램프하고 반올림', () => {
    const s = {};
    recordWordResult(s, '朋友', { perfect: true, timedOut: false, ms: -50 });
    recordWordResult(s, '朋友', { perfect: true, timedOut: false, ms: 1499.6 });
    expect(s['朋友']).toEqual([2, 2, 1500, 2]);
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

  it('복습필요 = 시도 1+ & 정답률 80% 미만', () => {
    expect(needsReview([3, 1, 0, 0])).toBe(true);   // 33%
    expect(needsReview([2, 2, 0, 0])).toBe(false);  // 100%
    expect(needsReview([0, 0, 0, 0])).toBe(false);  // 미시도
  });
});

describe('buildReviewList — 약한 순 정렬', () => {
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

describe('mergeStats — 시도수 많은 쪽 채택', () => {
  it('incoming의 attempts가 더 많으면 덮어쓴다', () => {
    const base = { A: [2, 1, 0, 0] };
    const incoming = { A: [5, 3, 0, 0] };
    expect(mergeStats(base, incoming).A).toEqual([5, 3, 0, 0]);
  });

  it('base의 attempts가 더 많으면 유지', () => {
    const base = { A: [9, 5, 0, 0] };
    const incoming = { A: [3, 3, 0, 0] };
    expect(mergeStats(base, incoming).A).toEqual([9, 5, 0, 0]);
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
