import { describe, expect, it } from 'vitest';
import { isOnFormPage } from './swUpdateGuard.js';

describe('작성 중 서비스워커 자동 업데이트 유예', () => {
  it.each([
    { pathname: '/personal/ABCD1234EFGH/homework/hw-1', hash: '' },
    { pathname: '/personal/ABCD1234EFGH/homework/hw-1/', hash: '#audio' },
    { pathname: '/student/ABCD1234EFGH/homework/hw-1', hash: '' },
    { pathname: '/', hash: '#/personal/ABCD1234EFGH/homework/hw-1' },
    { pathname: '/', hash: '#/personal/ABCD1234EFGH/homework/hw-1?tab=submit' },
    { pathname: '/', hash: '#/logs/log-1/edit' },
    { pathname: '/', hash: '#/classes/new' },
    { pathname: '/', hash: '#/students/student-1/edit' },
    { pathname: '/', hash: '#/payments/payment-1/edit' },
    { pathname: '/', hash: '#/homework/new' },
  ])('학생 숙제 또는 기존 강사 작성 경로 %j는 보호한다', (location) => {
    expect(isOnFormPage(location)).toBe(true);
  });

  it.each([
    { pathname: '/personal/ABCD1234EFGH', hash: '' },
    { pathname: '/', hash: '#/personal/ABCD1234EFGH' },
    { pathname: '/personal/ABCD1234EFGH/notice/notice-1', hash: '' },
    { pathname: '/', hash: '#/logs/log-1' },
    { pathname: '/', hash: '#/home' },
  ])('작성 화면을 이탈한 경로 %j에서는 업데이트를 허용한다', (location) => {
    expect(isOnFormPage(location)).toBe(false);
  });
});