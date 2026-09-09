import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage.jsx';
import { requestAppUpdate } from '../api/serviceWorkerUpdate.js';
import { getPushStatus } from '../api/pushNotifications.js';

vi.mock('../api/serviceWorkerUpdate.js', () => ({ requestAppUpdate: vi.fn() }));
vi.mock('../api/pushNotifications.js', () => ({ getPushStatus: vi.fn(), enablePushNotifications: vi.fn(), disablePushNotifications: vi.fn() }));
vi.mock('../components/PushDiagnosticsButton.jsx', () => ({ default: () => null }));

beforeEach(() => { getPushStatus.mockResolvedValue({ state: 'enabled' }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('알림 연결을 보존하는 앱 업데이트', () => {
  it('App에 업데이트 준비를 맡기고 직접 SW 교체나 중복 요청을 하지 않는다', async () => {
    const onUpdate = vi.fn();
    const deleteCache = vi.fn();
    vi.stubGlobal('caches', { keys: vi.fn(async () => ['teacher-push-click-v1']), delete: deleteCache });
    render(<MemoryRouter><SettingsPage onUpdate={onUpdate} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: '이 기기 알림 끄기' })).toBeTruthy());
    const button = screen.getByRole('button', { name: '앱 업데이트' });
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(requestAppUpdate).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
  });

  it('업데이트 실패 시 비밀 오류를 노출하지 않고 재시도할 수 있게 한다', async () => {
    const onUpdate = vi.fn(() => { throw new Error('private-token'); });
    render(<MemoryRouter><SettingsPage onUpdate={onUpdate} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '앱 업데이트' }));
    expect((await screen.findByRole('alert')).textContent).toContain('알림 연결은 유지');
    expect(document.body.textContent).not.toContain('private-token');
    expect(screen.getByRole('button', { name: '앱 업데이트' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: '이 기기 알림 끄기' })).toBeTruthy();
  });
});
