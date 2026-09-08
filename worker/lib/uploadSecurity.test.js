import { describe, it, expect } from 'vitest';
import { validateFileContent, isNotionUploadUrl } from './upload.js';
import { studentHomeworkPage } from './homeworkPrivacy.js';
describe('file content boundary', () => {
  it.each([['lesson.pdf', 'application/pdf'], ['photo.png', 'image/png'], ['voice.mp3', 'audio/mpeg']])('rejects HTML disguised as %s', async (name, type) => {
    expect(await validateFileContent(new File(['<html>synthetic</html>'], name, { type }))).toMatchObject({ ok: false, status: 415 });
  });
  it.each([
    ['lesson.pdf', 'application/pdf', '%PDF-1.7 fixture'],
    ['voice.wav', 'audio/wav', 'RIFF0000WAVEdata'],
    ['voice.m4a', 'audio/x-m4a', '0000ftypM4A '],
    ['voice.ogg', 'audio/ogg', 'OggS0000'],
    ['voice.mp3', 'audio/mpeg', 'ID3fixture'],
  ])('accepts actual %s signatures', async (name, type, bytes) => {
    expect(await validateFileContent(new File([bytes], name, { type }))).toEqual({ ok: true });
  });
  it('does not send a Notion credential to an alternate host or redirect endpoint', () => {
    expect(isNotionUploadUrl('https://api.notion.com/v1/file_uploads/test/send', 'test')).toBe(true);
    for (const url of ['https://other.invalid/v1/file_uploads/test/send', 'https://api.notion.com/redirect', 'https://user:pw@api.notion.com/v1/file_uploads/test/send']) expect(isNotionUploadUrl(url, 'test')).toBe(false);
  });
  it('student homework excludes signed URLs, other relations and workspace metadata', () => {
    const result = studentHomeworkPage({ id: 'fixture', created_by: { id: 'private' }, properties: {
      '제목': { title: [{ plain_text: '숙제' }] }, '학생': { relation: [{ id: 'private' }] },
      '학생 제출 파일': { files: [{ name: 'voice.mp3', file: { url: 'https://private.invalid/signed' } }] },
    } });
    expect(result.properties['제목'].title[0].plain_text).toBe('숙제');
    expect(result.properties['학생 제출 파일'].files).toEqual([{ name: 'voice.mp3' }]);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
