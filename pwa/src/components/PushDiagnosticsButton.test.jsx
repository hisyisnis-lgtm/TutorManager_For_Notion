import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PushDiagnosticsButton from './PushDiagnosticsButton.jsx';
import { collectPushDiagnostics } from '../api/pushDiagnostics.js';

vi.mock('../api/pushDiagnostics.js', () => ({ collectPushDiagnostics: vi.fn() }));
const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup(); vi.resetAllMocks();
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
  else delete navigator.clipboard;
});

describe('알림 진단 보기', () => {
  it('진단을 열기 전에는 수집하지 않으며 명시적인 복사 버튼만 클립보드에 쓴다', async () => {
    const value = { appVersion: '2.47.7', serviceWorker: { status: 'ok' } };
    collectPushDiagnostics.mockResolvedValue(value);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PushDiagnosticsButton />);
    expect(collectPushDiagnostics).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '알림 진단' }));
    await waitFor(() => expect(screen.getByRole('textbox').value).toBe(JSON.stringify(value, null, 2)));
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '진단 내용 복사' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(value, null, 2)));
  });

  it('클립보드가 차단되면 수동 복사할 내용을 유지한다', async () => {
    collectPushDiagnostics.mockResolvedValue({ status: 'unavailable' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    render(<PushDiagnosticsButton />);
    fireEvent.click(screen.getByRole('button', { name: '알림 진단' }));
    await screen.findByText('진단 내용을 복사해 전달해 주세요.');
    fireEvent.click(screen.getByRole('button', { name: '진단 내용 복사' }));
    expect(screen.getByRole('status').textContent).toContain('직접 복사');
    expect(screen.getByRole('textbox').value).toContain('unavailable');
  });

  it('수집 실패는 원본 오류 문자열을 드러내지 않는다', async () => {
    collectPushDiagnostics.mockRejectedValue(new Error('private-token'));
    render(<PushDiagnosticsButton />);
    fireEvent.click(screen.getByRole('button', { name: '알림 진단' }));
    await screen.findByText('진단 상태를 읽지 못했어요. 닫았다 다시 시도해 주세요.');
    expect(document.body.textContent).not.toContain('private-token');
    expect(screen.getByRole('button', { name: '진단 내용 복사' }).disabled).toBe(true);
  });
});
