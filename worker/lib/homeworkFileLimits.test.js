import { describe, expect, it, vi } from 'vitest';
import {
  MAX_FILE_BYTES, MAX_HOMEWORK_TOTAL_BYTES, HomeworkFileLimitError,
  isNotionFileSizeUrl, readHomeworkFileSizes, validateHomeworkFileTotals, validateHomeworkPropertyFiles,
} from './upload.js';

const ID = '33333333-3333-3333-3333-333333333333';
const URL = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/student/file.pdf?signature=fresh';
const stored = (name = 'file.pdf', url = URL) => ({ name, type: 'file', file: { url } });
const uploaded = () => ({ name: 'new.pdf', type: 'file_upload', file_upload: { id: ID } });
const notion = vi.fn(async () => ({ status: 'uploaded', content_length: '1024' }));

describe('homework aggregate file limits', () => {
  it('accepts exactly ten files and 50 MiB; rejects count, total, individual and unknown sizes', () => {
    const files = Array.from({ length: 10 }, () => ({ size: MAX_HOMEWORK_TOTAL_BYTES / 10 }));
    expect(() => validateHomeworkFileTotals(files)).not.toThrow();
    expect(() => validateHomeworkFileTotals([...files, { size: 1 }])).toThrow('최대 10개');
    expect(() => validateHomeworkFileTotals([{ size: MAX_FILE_BYTES + 1 }])).toThrow('개당 20 MiB');
    expect(() => validateHomeworkFileTotals(files.map((file, index) => ({ size: file.size + (index ? 0 : 1) })))).toThrow('전체 용량은 50 MiB');
    expect(() => validateHomeworkFileTotals([{ size: 0 }])).toThrow('확인하지 못했습니다');
  });

  it('allows only exact Notion hosts, never arbitrary S3 buckets, private hosts or credentials', () => {
    expect(isNotionFileSizeUrl(URL)).toBe(true);
    expect(isNotionFileSizeUrl('https://s3.us-west-2.amazonaws.com/secure.notion-static.com/file')).toBe(true);
    for (const value of [
      'http://prod-files-secure.s3.us-west-2.amazonaws.com/file',
      'https://prod-files-secure.s3.us-west-2.amazonaws.com.attacker.invalid/file',
      'https://s3.us-west-2.amazonaws.com/attacker-bucket/file',
      'https://127.0.0.1/file', 'https://user:secret@prod-files-secure.s3.us-west-2.amazonaws.com/file',
    ]) expect(isNotionFileSizeUrl(value), value).toBe(false);
  });

  it('uses a Range GET, reads total rather than the one-byte length, cancels the body and sends no credentials', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 206, headers: { 'Content-Range': 'bytes 0-0/8388608', 'Content-Length': '1' },
    });
    const fetchImpl = vi.fn(async () => response), authorize = vi.fn(async () => {});
    expect(await readHomeworkFileSizes([stored()], { fetchImpl, authorize })).toEqual([{ name: 'file.pdf', size: 8388608 }]);
    expect(fetchImpl).toHaveBeenCalledWith(URL, expect.objectContaining({
      redirect: 'manual', headers: { Range: 'bytes=0-0' }, signal: expect.any(AbortSignal),
    }));
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts a server that ignores Range but provides full length and refuses redirects or unknown lengths', async () => {
    expect(await readHomeworkFileSizes([stored()], {
      fetchImpl: async () => new Response(null, { headers: { 'Content-Length': '3000' } }),
    })).toEqual([{ name: 'file.pdf', size: 3000 }]);
    for (const response of [new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid' } }),
      new Response(null), new Response(null, { status: 206, headers: { 'Content-Length': '1' } })]) {
      await expect(readHomeworkFileSizes([stored()], { fetchImpl: async () => response })).rejects.toBeInstanceOf(HomeworkFileLimitError);
    }
  });

  it('reads trusted upload metadata instead of a client-provided size', async () => {
    notion.mockClear();
    expect(await readHomeworkFileSizes([{ ...uploaded(), size: 1 }], { notion })).toEqual([{ name: 'new.pdf', size: 1024 }]);
    expect(notion).toHaveBeenCalledWith('GET', `/file_uploads/${ID}`);
    await expect(readHomeworkFileSizes([uploaded()], { notion: async () => ({ status: 'pending', content_length: 1 }) })).rejects.toThrow('확인하지 못했습니다');
  });

  it('does not fetch untrusted or external URLs, and propagates revoked access', async () => {
    const fetchImpl = vi.fn(), revoked = new Error('revoked');
    await expect(readHomeworkFileSizes([stored('a.pdf', 'https://attacker.invalid')], { fetchImpl })).rejects.toThrow();
    await expect(readHomeworkFileSizes([{ name: 'a.pdf', type: 'external', external: { url: URL } }], { fetchImpl })).rejects.toThrow();
    await expect(readHomeworkFileSizes([stored()], { fetchImpl, authorize: async () => { throw revoked; } })).rejects.toBe(revoked);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('limits size lookups to two concurrent requests', async () => {
    let active = 0, maximum = 0;
    const fetchImpl = async () => {
      active += 1; maximum = Math.max(maximum, active);
      await Promise.resolve(); active -= 1;
      return new Response(null, { headers: { 'Content-Length': '100' } });
    };
    await readHomeworkFileSizes(Array.from({ length: 10 }, (_, index) => stored(`${index}.pdf`)), { fetchImpl });
    expect(maximum).toBe(2);
  });

  it('permits deleting legacy unknown/oversized files and replaces stale signatures with fresh server URLs', async () => {
    const previous = { '피드백 파일': { id: 'file%3Aid', files: [stored(), stored('extra.pdf', 'https://old.invalid')] } };
    const request = { 'file:id': { files: [stored('file.pdf', URL.replace('fresh', 'expired'))] } };
    const fetchImpl = vi.fn();
    await validateHomeworkPropertyFiles(request, previous, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(request['file:id'].files[0].file.url).toBe(URL);
  });

  it('checks retained and new files together, and rejects forged replacement URLs before any fetch', async () => {
    const previous = { '피드백 파일': { files: [stored()] } };
    const fetchImpl = vi.fn(async () => new Response(null, { headers: { 'Content-Length': String(20 * 1024 * 1024) } }));
    const properties = { '피드백 파일': { files: [stored(), uploaded(), uploaded()] } };
    await expect(validateHomeworkPropertyFiles(properties, previous, {
      fetchImpl, notion: async () => ({ status: 'uploaded', content_length: 20 * 1024 * 1024 }),
    })).rejects.toThrow('전체 용량은 50 MiB');
    fetchImpl.mockClear();
    await expect(validateHomeworkPropertyFiles({ '피드백 파일': { files: [stored('file.pdf', 'https://attacker.invalid/file.pdf')] } }, previous, { fetchImpl })).rejects.toThrow('새 파일을 업로드');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
