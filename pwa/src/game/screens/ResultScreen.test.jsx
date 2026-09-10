import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResultActions } from './ResultScreen.jsx';

afterEach(cleanup);

const callbacks = () => ({
  onRetry: vi.fn(), onContinue: vi.fn(), onHome: vi.fn(), onTraining: vi.fn(), onChooseMode: vi.fn(),
});
const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }));

describe('결과 하단 동작', () => {
  it('온보딩은 다른 모든 콜백이 있어도 지정된 홈 동작 하나만 제공한다', () => {
    const actions = callbacks();
    render(<ResultActions {...actions} homeOnly homeLabel="닉네임 설정하기"
      continueLabel="승급시험" toneSummary={{ state: 'practice' }} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    click('닉네임 설정하기');
    expect(actions.onHome).toHaveBeenCalledOnce();
    for (const name of ['onRetry', 'onContinue', 'onTraining', 'onChooseMode']) {
      expect(actions[name]).not.toHaveBeenCalled();
    }
  });

  it('연습이 필요한 결과는 트레이닝·다시하기·홈의 기존 콜백을 각각 유지한다', () => {
    const actions = callbacks();
    render(<ResultActions {...actions} onContinue={null} toneSummary={{ state: 'practice' }} />);

    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '모드 선택', exact: true })).toBeNull();
    click('트레이닝');
    expect(actions.onTraining).toHaveBeenCalledOnce();
    expect(actions.onRetry).not.toHaveBeenCalled();
    expect(actions.onChooseMode).not.toHaveBeenCalled();
    click('다시하기');
    click('홈으로 가기');
    expect(actions.onRetry).toHaveBeenCalledOnce();
    expect(actions.onHome).toHaveBeenCalledOnce();
  });

  it.each(['steady', 'building'])('%s 결과는 트레이닝 대신 모드 선택 콜백으로 연결한다', state => {
    const actions = callbacks();
    render(<ResultActions {...actions} onContinue={null} toneSummary={{ state }} />);

    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '트레이닝', exact: true })).toBeNull();
    click('모드 선택');
    expect(actions.onChooseMode).toHaveBeenCalledOnce();
    expect(actions.onTraining).not.toHaveBeenCalled();
    expect(actions.onContinue).not.toHaveBeenCalled();
  });

  it('계속하기가 있어도 요약 동작을 함께 제공하며 두 목적지를 바꾸지 않는다', () => {
    const actions = callbacks();
    render(<ResultActions {...actions} continueLabel="실전 승급시험" toneSummary={{ state: 'practice' }} />);

    expect(screen.getAllByRole('button')).toHaveLength(4);
    click('실전 승급시험');
    expect(actions.onContinue).toHaveBeenCalledOnce();
    expect(actions.onTraining).not.toHaveBeenCalled();
    expect(actions.onRetry).not.toHaveBeenCalled();
    click('트레이닝');
    expect(actions.onTraining).toHaveBeenCalledOnce();
    expect(actions.onContinue).toHaveBeenCalledOnce();
    click('다시하기');
    click('홈으로 가기');
    expect(actions.onRetry).toHaveBeenCalledOnce();
    expect(actions.onHome).toHaveBeenCalledOnce();
  });

  it('요약이 없으면 추가 동작 없이 사용자 정의 다시하기 라벨과 콜백을 보존한다', () => {
    const actions = callbacks();
    render(<ResultActions {...actions} onContinue={null} retryLabel="문제 풀러 가기" />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    click('문제 풀러 가기');
    click('홈으로 가기');
    expect(actions.onRetry).toHaveBeenCalledOnce();
    expect(actions.onHome).toHaveBeenCalledOnce();
    expect(actions.onTraining).not.toHaveBeenCalled();
    expect(actions.onChooseMode).not.toHaveBeenCalled();
  });

  it('연습 상태에서 트레이닝 콜백이 없으면 모드 선택으로 임의 대체하지 않는다', () => {
    const actions = callbacks();
    render(<ResultActions {...actions} onContinue={null} onTraining={undefined} toneSummary={{ state: 'practice' }} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '트레이닝', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '모드 선택', exact: true })).toBeNull();
    click('다시하기');
    expect(actions.onRetry).toHaveBeenCalledOnce();
    expect(actions.onChooseMode).not.toHaveBeenCalled();
  });

  it('기록 부족 상태에서 모드 선택 콜백이 없으면 트레이닝으로 임의 대체하지 않는다', () => {
    const actions = callbacks();
    render(<ResultActions {...actions} onContinue={null} onChooseMode={undefined} toneSummary={{ state: 'building' }} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '트레이닝', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '모드 선택', exact: true })).toBeNull();
    click('홈으로 가기');
    expect(actions.onHome).toHaveBeenCalledOnce();
    expect(actions.onTraining).not.toHaveBeenCalled();
  });
});
