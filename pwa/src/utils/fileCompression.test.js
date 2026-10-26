import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressExternalFile, EXTERNAL_COMPRESSION_MIN_BYTES, EXTERNAL_COMPRESSION_TIMEOUT_MS } from './fileCompression';

const SIZE = EXTERNAL_COMPRESSION_MIN_BYTES;
const makeFile = (name = 'notes.pdf', size = SIZE, type = 'application/pdf') => new File([new Uint8Array(size)], name, { type, lastModified: 1234 });
let workers;

beforeEach(() => {
  workers = [];
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('createImageBitmap', vi.fn());
  vi.stubGlobal('Worker', class {
    constructor() { workers.push(this); }
    postMessage = vi.fn();
    terminate = vi.fn();
    send(data) { this.onmessage({ data }); }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('큰 외부 파일 압축의 실패 복구와 교체 조건', () => {
  it('작은 파일·대상 외 파일·50MiB 초과 파일은 Worker 없이 원본을 유지한다', async () => {
    const stage = vi.fn();
    for (const file of [makeFile('small.pdf', SIZE - 1), makeFile('image.jpg', SIZE, 'image/jpeg'), makeFile('huge.pdf', 51 * 1024 * 1024)]) {
      expect(await compressExternalFile(file, { onStage: stage })).toBe(file);
    }
    expect(workers).toHaveLength(0);
    expect(stage).not.toHaveBeenCalled();
  });

  it('큰 PDF도 분석 단계에서는 확인 중만 알리고 실제 이미지 인코딩 신호 때 압축으로 전환한다', async () => {
    const stage = vi.fn();
    const pending = compressExternalFile(makeFile(), { onStage: stage });
    expect(stage.mock.calls).toEqual([['checking']]);
    workers[0].send({ stage: 'compressing' });
    workers[0].send({ stage: 'compressing' });
    expect(stage.mock.calls).toEqual([['checking'], ['compressing']]);
    workers[0].send({ bytes: new ArrayBuffer(SIZE * 0.8) });
    await pending;
    expect(stage.mock.calls).toEqual([['checking'], ['compressing'], [null]]);
  });

  it('압축할 이미지가 없는 PDF는 압축 중이라고 알리지 않고 확인 단계를 해제한다', async () => {
    const original = makeFile();
    const stage = vi.fn();
    const pending = compressExternalFile(original, { onStage: stage });
    workers[0].send({ bytes: null });
    expect(await pending).toBe(original);
    expect(stage.mock.calls).toEqual([['checking'], [null]]);
  });

  it('10% 이상 작아진 출력만 원래 파일명·수정시간을 보존해 반환하고 Worker를 종료한다', async () => {
    const original = makeFile();
    const progress = vi.fn();
    const pending = compressExternalFile(original, { onProgress: progress });
    workers[0].send({ bytes: new ArrayBuffer(SIZE * 0.8) });
    const result = await pending;
    expect(result).not.toBe(original);
    expect(result.name).toBe(original.name);
    expect(result.type).toBe('application/pdf');
    expect(result.lastModified).toBe(original.lastModified);
    expect(result.size).toBe(SIZE * 0.8);
    expect(progress).toHaveBeenLastCalledWith(1);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it.each([null, new ArrayBuffer(SIZE), new ArrayBuffer(SIZE * 0.95), new ArrayBuffer(0)])('효과 없는 출력 또는 처리불가 출력은 원본을 유지한다', async (bytes) => {
    const original = makeFile();
    const pending = compressExternalFile(original);
    workers[0].send({ bytes });
    expect(await pending).toBe(original);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it('30초가 지나면 Worker를 종료하고 원본을 반환한다', async () => {
    vi.useFakeTimers();
    const original = makeFile();
    const stage = vi.fn();
    const pending = compressExternalFile(original, { onStage: stage });
    workers[0].send({ stage: 'compressing' });
    await vi.advanceTimersByTimeAsync(EXTERNAL_COMPRESSION_TIMEOUT_MS);
    expect(await pending).toBe(original);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(stage).toHaveBeenLastCalledWith(null);
    workers[0].send({ stage: 'compressing' });
    expect(stage).toHaveBeenLastCalledWith(null);
  });

  it('모달이 닫혀 취소되면 Worker를 즉시 종료하고 늦은 결과를 무시한다', async () => {
    const original = makeFile();
    const controller = new AbortController();
    const pending = compressExternalFile(original, { signal: controller.signal });
    controller.abort();
    workers[0].send({ bytes: new ArrayBuffer(SIZE * 0.1) });
    expect(await pending).toBe(original);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it('디코드 전 녹음 길이를 확인하고 긴 녹음은 메모리 할당 없이 원본을 유지한다', async () => {
    const original = makeFile('lesson.wav', SIZE, 'audio/wav');
    const audio = document.createElement('audio');
    Object.defineProperty(audio, 'duration', { value: 3600 });
    vi.spyOn(audio, 'load').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(audio);
    const decode = vi.fn();
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decode; });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:recording'), revokeObjectURL: vi.fn() });
    const stage = vi.fn();
    const pending = compressExternalFile(original, { onStage: stage });
    audio.onloadedmetadata();
    expect(await pending).toBe(original);
    expect(decode).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
    expect(stage.mock.calls).toEqual([['checking'], [null]]);
  });

  it('Worker에서 오류가 나도 첨부를 실패시키지 않는다', async () => {
    const original = makeFile();
    const pending = compressExternalFile(original);
    workers[0].onerror(new Error('not supported'));
    expect(await pending).toBe(original);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
});
