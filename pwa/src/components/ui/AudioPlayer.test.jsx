import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FilePreview from './FilePreview.jsx';
import StudentAuthGate from '../StudentAuthGate.jsx';
import { setStudentSession, clearStudentSession } from '../../api/studentAuth.js';
import { notifyAuthChange } from '../../api/authState.js';
import { fixtureSession } from '../../api/authFixtures.js';

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn(); });
});
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('학생 오디오 인증 blob 재생', () => {
  it('파일 URL 없는 학생 DTO에서도 재생을 누르면 인증 fetcher로 불러와 재생하고 종료 시 해제한다', async () => {
    const fetcher = vi.fn(async () => 'blob:student-feedback');
    const view = render(<FilePreview file={{ name: '피드백.m4a' }} fetchInlineBlobUrl={fetcher} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await screen.findByRole('button', { name: '일시정지' });
    expect(view.container.querySelector('audio').getAttribute('src')).toBe('blob:student-feedback');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:student-feedback');
  });

  it('로그아웃으로 닫힌 플레이어의 늦은 blob 응답은 재생하지 않고 즉시 해제한다', async () => {
    setStudentSession('STUDENT_A', fixtureSession('student'));
    let respond;
    render(<StudentAuthGate token="STUDENT_A"><FilePreview file={{ name: '녹음.m4a' }}
      fetchInlineBlobUrl={() => new Promise((resolve) => { respond = resolve; })} /></StudentAuthGate>);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    act(() => clearStudentSession('STUDENT_A'));
    await act(async () => respond('blob:late-private'));
    expect(screen.getByText('본인 확인')).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-private');
  });

  it('강사에게 기존 URL이 있으면 기존 URL 재조회 경로를 유지한다', async () => {
    const fresh = vi.fn(async () => 'https://fixture.invalid/fresh.m4a');
    const fetcher = vi.fn();
    const view = render(<FilePreview file={{ name: '강사.m4a', url: 'https://fixture.invalid/original.m4a' }}
      onGetFreshUrl={fresh} fetchInlineBlobUrl={fetcher} />);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await waitFor(() => expect(view.container.querySelector('audio').getAttribute('src')).toContain('fresh.m4a'));
    expect(fresh).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    view.unmount();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
