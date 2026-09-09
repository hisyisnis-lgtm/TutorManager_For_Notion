import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage.jsx';

const INVALID_TOPIC_MESSAGE = '알림 코드는 영문·숫자·밑줄(_)·하이픈(-)만 128자까지 입력해 주세요.';
const renderPage = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe('설정의 ntfy 알림 코드 연결', () => {
  it('기존 저장 버튼으로 이름과 코드를 저장하고 다시 진입해도 유지한다', () => {
    const page = renderPage();
    fireEvent.change(screen.getByLabelText('강사 이름'), { target: { value: ' 가상 강사 ' } });
    fireEvent.change(screen.getByLabelText('ntfy 알림 코드'), { target: { value: ' fixture_topic-1 ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(localStorage.getItem('instructor_name')).toBe('가상 강사');
    expect(localStorage.getItem('ntfy_topic')).toBe('fixture_topic-1');
    expect(screen.getByLabelText('ntfy 알림 코드').value).toBe('fixture_topic-1');
    expect(screen.getByRole('button', { name: '저장됨' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '알림함 보기' }).getAttribute('href')).toBe('/notifications');

    page.unmount();
    renderPage();
    expect(screen.getByLabelText('강사 이름').value).toBe('가상 강사');
    expect(screen.getByLabelText('ntfy 알림 코드').value).toBe('fixture_topic-1');
  });

  it.each(['invalid/topic', '공개알림', 'topic with space', 'a'.repeat(129)])('잘못된 코드(%s)는 오류를 표시하고 기존 이름·코드를 보존한다', (invalidTopic) => {
    localStorage.setItem('instructor_name', '기존 강사');
    localStorage.setItem('ntfy_topic', 'fixture-existing');
    renderPage();
    fireEvent.change(screen.getByLabelText('강사 이름'), { target: { value: '저장되면 안 됨' } });
    const input = screen.getByLabelText('ntfy 알림 코드');
    fireEvent.change(input, { target: { value: invalidTopic } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByRole('alert').textContent).toBe(INVALID_TOPIC_MESSAGE);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(localStorage.getItem('instructor_name')).toBe('기존 강사');
    expect(localStorage.getItem('ntfy_topic')).toBe('fixture-existing');
    expect(screen.queryByRole('button', { name: '저장됨' })).toBeNull();

    fireEvent.change(input, { target: { value: 'fixture-corrected' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('공백만 입력하고 저장하면 연결이 해제되고 다시 진입해도 비어 있다', () => {
    localStorage.setItem('ntfy_topic', 'fixture-existing');
    const page = renderPage();
    fireEvent.change(screen.getByLabelText('강사 이름'), { target: { value: '가상 강사' } });
    fireEvent.change(screen.getByLabelText('ntfy 알림 코드'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(localStorage.getItem('ntfy_topic')).toBeNull();
    expect(localStorage.getItem('instructor_name')).toBe('가상 강사');
    expect(screen.getByLabelText('ntfy 알림 코드').value).toBe('');
    page.unmount();
    renderPage();
    expect(screen.getByLabelText('ntfy 알림 코드').value).toBe('');
  });

  it('코드 입력에 자동완성·교정을 사용하지 않고 기존 설정 기능을 유지한다', () => {
    renderPage();
    const input = screen.getByLabelText('ntfy 알림 코드');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('maxlength')).toBe('128');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(screen.getByText(/공개 토픽 코드를 아는 사람/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '복사' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: '업데이트 (강력 새로고침)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy();
  });
});
