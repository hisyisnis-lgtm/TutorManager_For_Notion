import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TonePracticeSummary } from './TonePracticeSummary.jsx';
import { summarizeTonePractice, TONE_NUMS } from '../toneStats.js';

afterEach(cleanup);
describe('게임 결과 학습 요약', () => {
  it('최근 가중치가 아닌 실제 누적 수치를 보여준다', () => {
    render(<TonePracticeSummary summary={summarizeTonePractice({ 2: [4, 10, 0.95] })} />);
    expect(screen.getByText('40%')).not.toBeNull();
    expect(screen.getByLabelText('2성 정답 4/10회')).not.toBeNull();
    expect(screen.queryByText(/발음 실력|발음 평가/)).toBeNull();
  });
  it('기록 부족과 없는 기록을 구분한다', () => {
    render(<TonePracticeSummary summary={summarizeTonePractice({ 1: [1, 2] })} />);
    expect(screen.getByLabelText('1성 정답 1/2회, 기록 적음')).not.toBeNull();
    expect(screen.getAllByLabelText(/아직 기록 없음/)).toHaveLength(4);
  });
  it('모두 양호하면 특정 성조를 지목하지 않는다', () => {
    render(<TonePracticeSummary summary={summarizeTonePractice(Object.fromEntries(TONE_NUMS.map(tone => [tone, [9, 10]])))} />);
    expect(screen.getAllByText('90%')).toHaveLength(5);
    expect(screen.queryByText(/응답을 한 번 더 연습/)).toBeNull();
  });
  it('기록 카드에는 행동 버튼을 중복 배치하지 않는다', () => {
    render(<TonePracticeSummary summary={summarizeTonePractice({})} />);
    expect(screen.getAllByLabelText(/아직 기록 없음/)).toHaveLength(5);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
