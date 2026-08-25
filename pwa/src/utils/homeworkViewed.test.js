// 피드백 숙제의 "이미 확인함" 판정 회귀 테스트.
//
// 2026-08-25에 고친 버그: 판정이 localStorage만 봐서, 기기를 바꾸거나 브라우저 데이터를 지운
// 학생에게 예전에 다 확인한 피드백이 홈에 통째로 다시 쏟아졌다(실측: 서버엔 10건 다 확인됨인데
// 홈엔 10장). iOS는 Safari ↔ 설치 PWA 저장소가 갈려 기기 교체가 아니어도 재현된다.
import { describe, it, expect, beforeEach } from 'vitest';
import { isFeedbackArchived, markViewed, HW_VIEWED_KEY } from './homeworkViewed.js';

const TOKEN = 'TESTTOKEN123';
const HW = 'hw-1';

beforeEach(() => localStorage.clear());

describe('isFeedbackArchived', () => {
  it('아무 기록도 없으면 "안 봤음" — 홈에 남는다', () => {
    expect(isFeedbackArchived(TOKEN, HW, '2026-08-01T00:00:00Z', null)).toBe(false);
  });

  it('로컬 기록만 있어도 확인한 것으로 본다(기존 동작 유지)', () => {
    markViewed(TOKEN, HW);
    expect(isFeedbackArchived(TOKEN, HW, '2026-08-01T00:00:00Z', null)).toBe(true);
  });

  it('★ 로컬 기록이 없어도 서버 확인일이 있으면 확인한 것으로 본다 — 기기 교체 시 도배 방지', () => {
    expect(isFeedbackArchived(TOKEN, HW, '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z')).toBe(true);
  });

  it('★ 본 뒤에 강사가 새 피드백을 주면 다시 보여준다(서버 기록 기준)', () => {
    // 확인 8/2 → 새 피드백 8/10 → 아직 안 본 새 피드백이므로 홈에 노출
    expect(isFeedbackArchived(TOKEN, HW, '2026-08-10T00:00:00Z', '2026-08-02T00:00:00Z')).toBe(false);
  });

  it('로컬·서버 중 더 최근 기록을 기준으로 삼는다', () => {
    // 서버는 옛날(8/1)뿐이지만 로컬에서 방금 봤다면, 8/10 피드백도 확인한 것
    localStorage.setItem(HW_VIEWED_KEY(TOKEN), JSON.stringify({ [HW]: Date.parse('2026-08-20T00:00:00Z') }));
    expect(isFeedbackArchived(TOKEN, HW, '2026-08-10T00:00:00Z', '2026-08-01T00:00:00Z')).toBe(true);
  });

  it('피드백일이 없으면 확인 기록만으로 판단한다', () => {
    expect(isFeedbackArchived(TOKEN, HW, null, '2026-08-02T00:00:00Z')).toBe(true);
    expect(isFeedbackArchived(TOKEN, HW, null, null)).toBe(false);
  });

  it('망가진 날짜 문자열은 기록 없음으로 취급해 숨기지 않는다', () => {
    expect(isFeedbackArchived(TOKEN, HW, '2026-08-01T00:00:00Z', '이상한값')).toBe(false);
  });

  it('학생 토큰이 다르면 남의 확인 기록을 쓰지 않는다', () => {
    markViewed(TOKEN, HW);
    expect(isFeedbackArchived('OTHERTOKEN99', HW, '2026-08-01T00:00:00Z', null)).toBe(false);
  });
});
