import { describe, it, expect } from 'vitest';
import { expectedMp4Size, ensureCompleteFile, truncatedFileMessage } from './audioIntegrity.js';

// 최상위 박스 하나를 만든다 — [4B 길이][4B 타입][본문]
function box(type, bodyLength) {
  const size = 8 + bodyLength;
  const buf = new Uint8Array(size);
  new DataView(buf.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i += 1) buf[4 + i] = type.charCodeAt(i);
  return buf;
}

// 갤럭시 녹음기가 만드는 구조를 흉내: ftyp + mdat + moov(끝에 재생 색인)
function makeM4a({ mdat = 1000, moov = 300 } = {}) {
  const parts = [box('ftyp', 16), box('mdat', mdat), box('moov', moov)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function fileFrom(bytes, name = 'rec.m4a') {
  return new File([bytes], name, { type: 'audio/mp4' });
}

describe('expectedMp4Size', () => {
  it('온전한 m4a는 실제 크기와 같은 값을 돌려준다', async () => {
    const bytes = makeM4a();
    const f = fileFrom(bytes);
    expect(await expectedMp4Size(f)).toBe(bytes.length);
  });

  it('뒤가 잘린 m4a는 원래 크기(실제보다 큰 값)를 돌려준다', async () => {
    const full = makeM4a();
    const cut = full.slice(0, full.length - 120); // moov 중간에서 절단 — 실제 사고와 같은 모양
    expect(await expectedMp4Size(fileFrom(cut))).toBe(full.length);
  });

  it('MP4가 아니면 null — 다른 형식 업로드를 방해하지 않는다', async () => {
    const notMp4 = new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8])], 'a.webm', { type: 'audio/webm' });
    expect(await expectedMp4Size(notMp4)).toBeNull();
  });

  it('빈 파일·비파일 입력에 안전', async () => {
    expect(await expectedMp4Size(null)).toBeNull();
    expect(await expectedMp4Size(new File([], 'empty.m4a'))).toBeNull();
  });
});

describe('ensureCompleteFile', () => {
  it('온전한 파일은 그대로 통과시킨다', async () => {
    const f = fileFrom(makeM4a());
    const r = await ensureCompleteFile(f);
    expect(r.ok).toBe(true);
    expect(r.recovered).toBe(false);
    expect(r.file).toBe(f);
  });

  it('MP4가 아닌 파일도 통과 — 검사 대상이 아님', async () => {
    const f = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'a.pdf', { type: 'application/pdf' });
    expect((await ensureCompleteFile(f)).ok).toBe(true);
  });

  it('잘렸고 뒷부분을 못 읽으면 ok=false — 업로드가 중단되어야 한다', async () => {
    const full = makeM4a();
    const cut = full.slice(0, full.length - 120);
    const r = await ensureCompleteFile(fileFrom(cut));
    expect(r.ok).toBe(false);
    expect(r.expected).toBe(full.length);
    expect(r.actual).toBe(cut.length);
  });

  it('크기만 짧게 보고된 경우 뒷부분을 읽어 되살린다 (안드로이드 상황)', async () => {
    // size는 짧게 말하지만 slice로 요청하면 뒷부분을 내주는 파일을 흉내낸다.
    const full = makeM4a();
    const shortSize = full.length - 120;
    const fake = {
      name: 'rec.m4a',
      type: 'audio/mp4',
      lastModified: 0,
      size: shortSize,
      slice: (start, end) => new Blob([full.slice(start, end)]),
    };
    const r = await ensureCompleteFile(fake);
    expect(r.ok).toBe(true);
    expect(r.recovered).toBe(true);
    expect(r.file.size).toBe(full.length);
  });
});

describe('truncatedFileMessage', () => {
  it('실제 크기·원래 크기·대처법을 함께 안내한다', () => {
    const msg = truncatedFileMessage('녹음.m4a', 3103700, 3126011);
    expect(msg).toContain('녹음.m4a');
    expect(msg).toContain('2.96MB');
    expect(msg).toContain('2.98MB');
    expect(msg).toContain('복사');
  });
});
