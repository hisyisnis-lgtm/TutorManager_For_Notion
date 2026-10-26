import { describe, expect, it } from 'vitest';
import { homeworkFileUsage, validateHomeworkFiles, MAX_FILES, MAX_TOTAL_FILE_BYTES } from './homeworkLimits.js';

const MiB = 1024 * 1024;
describe('숙제 첨부 개수·합계 용량', () => {
  it('기존 파일과 새 파일을 합쳐 10개까지 허용한다', () => {
    const files = Array.from({ length: MAX_FILES }, () => ({ size: 1 }));
    expect(validateHomeworkFiles(files).ok).toBe(true);
    expect(validateHomeworkFiles([...files, { size: 1 }])).toMatchObject({ ok: false, error: expect.stringContaining('10개') });
  });
  it('기존 20MB와 새 20MB·10MB는 허용하되 1바이트라도 넘으면 거절한다', () => {
    const files = [{ name: '기존.pdf', size: 20 * MiB }, { file: { size: 20 * MiB } }, { file: { size: 10 * MiB } }];
    expect(validateHomeworkFiles(files)).toMatchObject({ ok: true, bytes: MAX_TOTAL_FILE_BYTES });
    expect(validateHomeworkFiles([...files, { file: { size: 1 } }])).toMatchObject({ ok: false, error: expect.stringContaining('50MB') });
  });
  it('파일당 20MB를 유지한다', () => {
    expect(validateHomeworkFiles([{ file: { size: 20 * MiB } }]).ok).toBe(true);
    expect(validateHomeworkFiles([{ size: 20 * MiB + 1 }])).toMatchObject({ ok: false, error: expect.stringContaining('20MB') });
  });
  it('기존 용량 누락이나 잘못된 크기를 0으로 취급하지 않는다', () => {
    expect(homeworkFileUsage([{ size: 5 }, { name: '미확인.pdf' }, { size: -1 }])).toEqual({ count: 3, bytes: 5, unknownCount: 2 });
    expect(validateHomeworkFiles([{ name: '기존.pdf' }])).toMatchObject({ ok: false, error: expect.stringContaining('확인하지 못했어요') });
  });
});
