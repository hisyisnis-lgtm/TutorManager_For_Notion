// CoachMarkOverlay 최소 렌더 테스트 — 게임 5개 화면 + 학생앱 PersonalPage가 공유하는 컴포넌트.
// 목적: 렌더가 죽지 않는지 / steps·showControls prop이 화면에 반영되는지 / 진행·종료 콜백이 동작하는지 고정.
// jsdom에선 getBoundingClientRect가 0을 돌려주므로 spotlight 좌표 검증은 하지 않는다(레이아웃은 시각검수 영역).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import CoachMarkOverlay from './CoachMarkOverlay.jsx';

afterEach(cleanup);

const STEPS = [
  { selector: null, label: '첫 번째 안내 문구' },
  { selector: null, label: '두 번째 안내 문구' },
];

describe('CoachMarkOverlay', () => {
  it('visible=false면 아무것도 렌더하지 않는다', () => {
    render(<CoachMarkOverlay steps={STEPS} visible={false} onDone={() => {}} />);
    expect(screen.queryByText('첫 번째 안내 문구')).toBeNull();
  });

  it('visible=true면 렌더가 죽지 않고 첫 스텝 라벨·컨트롤이 보인다', () => {
    expect(() =>
      render(<CoachMarkOverlay steps={STEPS} visible onDone={() => {}} delay={0} />),
    ).not.toThrow();
    expect(screen.getByText('첫 번째 안내 문구')).toBeTruthy();
    expect(screen.getByText('건너뛰기')).toBeTruthy();
    expect(screen.getByText('다음 →')).toBeTruthy(); // 2스텝이므로 아직 '완료'가 아니다
  });

  it('showControls=false면 하단 컨트롤 대신 진행 힌트만 보여준다', () => {
    render(<CoachMarkOverlay steps={STEPS} visible onDone={() => {}} delay={0} showControls={false} />);
    expect(screen.queryByText('건너뛰기')).toBeNull();
    expect(screen.getByText('탭하여 계속')).toBeTruthy();
  });

  it("'다음' 클릭 시 다음 스텝 라벨로 넘어가고 마지막 스텝엔 '완료'가 표시된다", async () => {
    render(<CoachMarkOverlay steps={STEPS} visible onDone={() => {}} delay={0} />);
    fireEvent.click(screen.getByText('다음 →'));
    // advance는 160ms dimming 후 스텝을 바꾼다
    await waitFor(() => expect(screen.getByText('두 번째 안내 문구')).toBeTruthy());
    expect(screen.getByText('완료')).toBeTruthy();
  });

  it("'건너뛰기' 클릭 시 페이드아웃 후 onDone이 호출된다", async () => {
    const onDone = vi.fn();
    render(<CoachMarkOverlay steps={STEPS} visible onDone={onDone} delay={0} />);
    fireEvent.click(screen.getByText('건너뛰기'));
    // finish는 220ms 페이드아웃 후 onDone을 부른다
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('첫 번째 안내 문구')).toBeNull(); // 언마운트까지 확인
  });

  it("마지막 스텝에서 '완료' 클릭 시 onDone이 호출된다", async () => {
    const onDone = vi.fn();
    render(<CoachMarkOverlay steps={[STEPS[0]]} visible onDone={onDone} delay={0} />);
    fireEvent.click(screen.getByText('완료')); // 1스텝짜리는 처음부터 '완료'
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
