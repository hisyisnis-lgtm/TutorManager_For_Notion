import { describe, expect, it } from 'vitest';
import { studentPagePath } from './studentAppPaths.js';
describe('legacy and member student routes coexist', () => {
  it.each(['', 'homework/hw-1', 'notice/n-1', 'consent', 'panda'])('keeps legacy route %s', suffix => {
    expect(studentPagePath('ABCD1234EFGH', suffix)).toBe('/personal/ABCD1234EFGH' + (suffix ? '/' + suffix : ''));
  });
  it.each(['', 'homework/hw-1', 'notice/n-1', 'consent', 'panda'])('never exposes member scope on route %s', suffix => {
    const result=studentPagePath('app-member-private-scope', suffix);
    expect(result).toBe('/personal/' + suffix);
    expect(result).not.toContain('app-member-private-scope');
  });
});
