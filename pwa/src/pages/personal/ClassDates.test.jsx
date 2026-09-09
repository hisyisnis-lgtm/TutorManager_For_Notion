import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClassCard from './ClassCard.jsx';
import HomeTab from './HomeTab.jsx';
import { fetchMyClasses } from '../../api/bookingApi.js';
import { setStudentSession } from '../../api/studentAuth.js';
import { fixtureSession } from '../../api/authFixtures.js';
import { notifyAuthChange } from '../../api/authState.js';

vi.mock('../../api/bookingApi.js', () => ({ fetchMyClasses: vi.fn() }));
const token = 'ABCD1234EFGH';
const cls = { id: 'class-1', date: '2026-09-10', startTime: '10:00', durationMin: 60, isCancelled: false };
const zones = ['Asia/Seoul', 'Asia/Shanghai', 'UTC', 'America/Los_Angeles'];

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  setStudentSession(token, fixtureSession('student', `personal:${token}`));
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T10:00:00+09:00'));
  vi.mocked(fetchMyClasses).mockImplementation(async (_, month) => month === '2026-09' ? [cls] : []);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
});

describe('학생 수업 날짜는 기기 시간대와 무관한 KST 달력 날짜', () => {
  it.each(zones)('%s에서 예약 카드의 날짜와 요일이 일치한다', (zone) => {
    vi.stubEnv('TZ', zone);
    render(<ClassCard cls={cls} todayStr="2026-09-07" nowMin={600} />);
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('목요일')).toBeTruthy();
    expect(screen.queryByText('수요일')).toBeNull();
  });

  it.each(zones)('%s에서 다음 수업의 월·일·요일도 동일하다', async (zone) => {
    vi.stubEnv('TZ', zone);
    render(<MemoryRouter><HomeTab studentToken={token} studentLoaded homeworkEnabled={false} /></MemoryRouter>);
    expect(await screen.findByText('9월 10일 목요일')).toBeTruthy();
    expect(screen.queryByText('9월 9일 수요일')).toBeNull();
  });
});