import { describe, expect, it } from 'vitest';
import { isPublicHashRoute } from './publicHashRoute.js';

describe('공개 해시 경로 판별', () => {
  it.each(['#/students', '#/students/new', '#/students/student-one', '#/students/student-one/edit', '#/home', '#/classes'])('강사 경로 %s를 공개 학생 진입으로 분류하지 않는다', hash => {
    expect(isPublicHashRoute(hash)).toBe(false);
  });
  it.each(['#/student/code', '#/personal/', '#/intro', '#/pricing?from=home', '#/privacy', '#/consent', '#/book/legacy', '#/group-class', '#/bootcamp'])('공개·학생 호환 경로 %s는 유지한다', hash => {
    expect(isPublicHashRoute(hash)).toBe(true);
  });
  it('팬더 디버그는 개발 환경의 정확한 경로만 허용한다', () => {
    expect(isPublicHashRoute('#/panda-test', true)).toBe(true);
    expect(isPublicHashRoute('#/panda-test')).toBe(false);
    expect(isPublicHashRoute('#/panda-tests', true)).toBe(false);
  });
});
