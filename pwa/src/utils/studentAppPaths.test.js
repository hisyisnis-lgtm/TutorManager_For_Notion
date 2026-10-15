import { afterEach, describe, expect, it } from 'vitest';
import { canonicalStudentPath, normalizeStudentAppEntry } from './studentAppPaths.js';

afterEach(() => { window.history.replaceState(null, '', '/'); localStorage.clear(); });
describe('학생 주소의 개인 코드 제거', () => {
  it.each([
    ['/personal', '/personal/'],
    ['/personal/', '/personal/'],
    ['/personal/homework/hw-1', '/personal/homework/hw-1'],
    ['/personal/notice/id-1', '/personal/notice/id-1'],
    ['/personal/consent', '/personal/consent'],
    ['/personal/panda', '/personal/panda'],
    ['/personal/ABCD1234EFGH', '/personal/'],
    ['/student/ABCD1234EFGH', '/personal/'],
    ['/personal/ABCD1234EFGH/homework/hw-1?code=private', '/personal/homework/hw-1'],
    ['/student/ABCD1234EFGH/notice/id-1', '/personal/notice/id-1'],
    ['/personal/ABCD1234EFGH/panda', '/personal/panda'],
    ['/personal/ABCD1234EFGH/game/tone', '/personal/'],
    ['/personal/unknown/nested/path', '/personal/'],
    ['/personalities/ABCD1234EFGH', null],
    ['/game/tone', null],
  ])('%s → %s', (input, expected) => expect(canonicalStudentPath(input)).toBe(expected));

  it.each([
    ['/personal/ABCD1234EFGH?code=ABCD1234EFGH#private', '/personal/'],
    ['/#/personal/ABCD1234EFGH/homework/hw-1?session=private', '/personal/homework/hw-1'],
    ['/student/ABCD1234EFGH/consent', '/personal/consent'],
  ])('옛 주소 %s의 history와 저장 코드를 정리한다', (input, expected) => {
    localStorage.setItem('personal_student_token', 'ABCD1234EFGH');
    window.history.replaceState(null, '', input);
    expect(normalizeStudentAppEntry()).toBe(true);
    expect(window.location.pathname).toBe(expected);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(localStorage.getItem('personal_student_token')).toBeNull();
  });
  it('강사 경로와 독립 게임의 주소는 유지한다', () => {
    window.history.replaceState(null, '', '/#/home');
    expect(normalizeStudentAppEntry()).toBe(false);
    expect(window.location.hash).toBe('#/home');
  });
});
