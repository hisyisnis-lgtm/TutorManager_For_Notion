import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import useFileAttach from './useFileAttach.js';
import { compressExternalFile } from '../utils/fileCompression.js';
import { compressImage } from '../utils/imageCompress.js';
import { ensureCompleteFile, truncatedFileMessage } from '../utils/audioIntegrity.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../utils/fileCompression.js', () => ({ compressExternalFile: vi.fn() }));
vi.mock('../utils/imageCompress.js', () => ({ compressImage: vi.fn() }));
vi.mock('../utils/audioIntegrity.js', () => ({ ensureCompleteFile: vi.fn(), truncatedFileMessage: vi.fn() }));

const MiB = 1024 * 1024;
const file = (size = 1, name = '숙제.pdf', type = 'application/pdf') => new File([new Uint8Array(size)], name, { type });
const change = (files) => ({ target: { files, value: 'selected' } });
const options = (extra = {}) => ({ genName: (index) => `숙제_${index}`, fixedFiles: [], onConfirm: vi.fn(), ...extra });
const row = (sourceFile = file(), extra = {}) => ({ tempId: Math.random(), file: sourceFile, baseName: '숙제', ext: '.pdf', ...extra });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
beforeEach(() => {
  vi.resetAllMocks();
  compressExternalFile.mockImplementation(async (item) => item);
  compressImage.mockImplementation(async (item) => item);
  ensureCompleteFile.mockImplementation(async (item) => ({ ok: true, file: item }));
  truncatedFileMessage.mockReturnValue('녹음이 손상되었어요');
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const expectNoPreparation = () => {
  expect(compressExternalFile).not.toHaveBeenCalled();
  expect(compressImage).not.toHaveBeenCalled();
  expect(ensureCompleteFile).not.toHaveBeenCalled();
};

describe('통합 파일 선택은 전체 검증 후 종류별 초안으로 전달', () => {
  it('녹음·PDF·이미지를 함께 골라도 원본과 이름을 보존하고 준비나 용량 조회를 시작하지 않는다', () => {
    const loadFileSizes = vi.fn();
    const opts = options({ directSelection: true, fixedFiles: [{ name: '기존.pdf' }], loadFileSizes });
    const originals = [
      file(25 * MiB, '큰 숙제 원문.pdf'),
      file(8, '발음 연습.m4a', 'audio/mp4'),
      file(2, '연습 사진.png', 'image/png'),
      file(8, '두 번째 녹음.wav', 'audio/wav'),
    ];
    const readOriginal = vi.fn();
    originals.forEach(original => Object.defineProperty(original, 'arrayBuffer', { value: readOriginal }));
    const { result } = renderHook(() => useFileAttach(opts));
    const event = change(originals);
    act(() => result.current.handleFilePickChange(event));
    expect(event.target.value).toBe('');
    expect(opts.onConfirm).toHaveBeenCalledTimes(2);
    const audio = opts.onConfirm.mock.calls.find(([kind]) => kind === 'audio')[1];
    const documents = opts.onConfirm.mock.calls.find(([kind]) => kind === 'document')[1];
    expect(audio).toEqual([
      expect.objectContaining({ file: originals[1], baseName: '발음 연습', ext: '.m4a', category: 'audio', source: 'external' }),
      expect.objectContaining({ file: originals[3], baseName: '두 번째 녹음', ext: '.wav', category: 'audio', source: 'external' }),
    ]);
    expect(documents).toEqual([
      expect.objectContaining({ file: originals[0], baseName: '큰 숙제 원문', ext: '.pdf', category: 'document', source: 'external' }),
      expect.objectContaining({ file: originals[2], baseName: '연습 사진', ext: '.png', category: 'document', source: 'external' }),
    ]);
    [...audio, ...documents].forEach(entry => expect(originals.some(original => original === entry.file)).toBe(true));
    expect(new Set([...audio, ...documents].map(entry => entry.tempId)).size).toBe(4);
    expect(readOriginal).not.toHaveBeenCalled();
    expect(loadFileSizes).not.toHaveBeenCalled();
    expect(result.current.modalKind).toBe(null);
    expect(result.current.sessionFiles).toEqual([]);
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparationStage).toBe(null);
    expectNoPreparation();
  });

  it.each([
    ['지원하지 않는 MIME', () => file(8, '실행파일.pdf', 'application/x-msdownload')],
    ['지원하지 않는 확장자', () => file(8, '압축파일.zip', '')],
    ['빈 파일', () => file(0, '빈 녹음.wav', 'audio/wav')],
  ])('%s이 함께 있으면 정상 파일도 일부 추가하지 않는다', (_label, rejectedFile) => {
    const opts = options({ directSelection: true });
    const { result } = renderHook(() => useFileAttach(opts));
    const event = change([file(), file(8, '발음.wav', 'audio/wav'), rejectedFile()]);
    act(() => result.current.handleFilePickChange(event));
    expect(opts.onConfirm).not.toHaveBeenCalled();
    expect(event.target.value).toBe('');
    expect(toast.error).toHaveBeenCalledOnce();
    expect(result.current.sessionFiles).toEqual([]);
    expectNoPreparation();
  });

  it('기존 파일과 선택 전체의 합이 10개를 넘으면 모두 거절하고, 남은 두 자리에는 혼합 두 개를 허용한다', () => {
    const onConfirm = vi.fn();
    const fixed = Array.from({ length: 9 }, (_, index) => ({ name: `기존${index}.pdf` }));
    const picked = [file(), file(8, '발음.wav', 'audio/wav')];
    const { result, rerender } = renderHook(({ existing }) => useFileAttach(options({ directSelection: true, fixedFiles: existing, onConfirm })), { initialProps: { existing: fixed } });
    act(() => result.current.handleFilePickChange(change(picked)));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('10개'));
    rerender({ existing: fixed.slice(0, 8) });
    act(() => result.current.handleFilePickChange(change(picked)));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm.mock.calls.flatMap(([, entries]) => entries)).toHaveLength(2);
    expectNoPreparation();
  });

  it('종류가 하나뿐이면 해당 콜백만 호출하고 같은 파일을 다시 선택할 수 있도록 input을 비운다', () => {
    const opts = options({ directSelection: true });
    const original = file(8, '발음.wav', 'audio/wav');
    const { result } = renderHook(() => useFileAttach(opts));
    const event = change([original]);
    act(() => result.current.handleFilePickChange(event));
    expect(event.target.value).toBe('');
    event.target.value = 'selected-again';
    act(() => result.current.handleFilePickChange(event));
    expect(event.target.value).toBe('');
    expect(opts.onConfirm).toHaveBeenCalledTimes(2);
    expect(opts.onConfirm.mock.calls.every(([kind, entries]) => kind === 'audio' && entries.length === 1 && entries[0].file === original)).toBe(true);
    expect(opts.onConfirm.mock.calls[0][1][0]).not.toBe(opts.onConfirm.mock.calls[1][1][0]);
    expectNoPreparation();
  });

  it('선택 취소는 파일·모달·오류를 만들지 않고 통합 버튼은 네이티브 선택기만 연다', () => {
    const opts = options({ directSelection: true });
    const { result } = renderHook(() => useFileAttach(opts));
    const click = vi.fn();
    result.current.fileInputRef.current = { click };
    act(() => result.current.tryOpenFilePicker());
    expect(click).toHaveBeenCalledOnce();
    const event = change([]);
    act(() => result.current.handleFilePickChange(event));
    expect(event.target.value).toBe('');
    expect(opts.onConfirm).not.toHaveBeenCalled();
    expect(result.current.modalKind).toBe(null);
    expect(toast.error).not.toHaveBeenCalled();
    expectNoPreparation();
  });

  it('10개가 이미 있으면 통합 선택기를 열지 않는다', () => {
    const opts = options({ directSelection: true, fixedFiles: Array.from({ length: 10 }, () => ({ name: '기존.pdf', size: 1 })) });
    const { result } = renderHook(() => useFileAttach(opts));
    const click = vi.fn();
    result.current.fileInputRef.current = { click };
    act(() => result.current.tryOpenFilePicker());
    expect(click).not.toHaveBeenCalled();
    expect(opts.onConfirm).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('10개'));
    expectNoPreparation();
  });
});

describe('선택과 모달 확인은 원본 목록만 변경', () => {
  it('미확인 기존 용량과 20MiB 초과 원본도 읽기·압축·로딩 없이 선택하고 확인한다', () => {
    const loadFileSizes = vi.fn();
    const opts = options({ fixedFiles: [{ name: '기존.pdf' }], loadFileSizes });
    const original = file(25 * MiB);
    const { result } = renderHook(() => useFileAttach(opts));
    act(() => result.current.openModal('document'));
    act(() => result.current.handleDocPickChange(change([original])));
    expect(result.current.sessionFiles[0].file).toBe(original);
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparationStage).toBe(null);
    act(() => result.current.handleSessionConfirm());
    expect(opts.onConfirm).toHaveBeenCalledWith('document', [expect.objectContaining({ file: original, category: 'document', source: 'external' })]);
    expect(loadFileSizes).not.toHaveBeenCalled();
    expectNoPreparation();
  });

  it('단일 외부 녹음의 이름을 정해도 원본을 읽거나 재포장하지 않는다', () => {
    const original = file(26 * MiB, 'long.wav', 'audio/wav');
    const { result } = renderHook(() => useFileAttach(options()));
    act(() => result.current.openModal('audio'));
    act(() => result.current.handleAudioPickChange(change([original])));
    expect(result.current.modalView).toBe('naming');
    act(() => result.current.handleNamingConfirm());
    expect(result.current.sessionFiles[0]).toEqual(expect.objectContaining({ file: original, ext: '.wav', source: 'external', category: 'audio' }));
    expectNoPreparation();
  });

  it('기존 파일을 포함한 11개 선택은 즉시 거절한다', () => {
    const { result } = renderHook(() => useFileAttach(options({ fixedFiles: [{ name: '기존.pdf' }] })));
    act(() => result.current.handleDocPickChange(change(Array.from({ length: 10 }, () => file()))));
    expect(result.current.sessionFiles).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('10개'));
    expectNoPreparation();
  });

  it.each([
    ['document', () => file(1, 'bad.pdf', 'application/x-msdownload')],
    ['document', () => file(0)],
    ['document', () => file(1, 'audio.wav', 'audio/wav')],
    ['audio', () => file()],
  ])('선택 단계에서도 빈 파일·허용하지 않는 MIME·잘못된 카테고리를 거절한다: %s', (category, createFile) => {
    const { result } = renderHook(() => useFileAttach(options()));
    act(() => category === 'audio' ? result.current.handleAudioPickChange(change([createFile()])) : result.current.handleDocPickChange(change([createFile()])));
    expect(result.current.sessionFiles).toHaveLength(0);
    expect(result.current.namingFile).toBe(null);
    expect(toast.error).toHaveBeenCalled();
    expectNoPreparation();
  });

  it('직접 녹음은 원본과 recording 출처를 보존해 목록에 담는다', () => {
    const original = file(8, '직접녹음.webm', 'audio/webm');
    const { result } = renderHook(() => useFileAttach(options()));
    act(() => result.current.handleRecorderFile(original));
    expect(result.current.sessionFiles[0]).toEqual(expect.objectContaining({ file: original, category: 'audio', source: 'recording' }));
    expectNoPreparation();
  });
});

describe('학생 직접 선택은 중간 모달 없이 원본을 바로 전달', () => {
  it('문서와 이미지는 원본 파일·이름을 보존해 바로 전달하고 용량 조회나 준비를 시작하지 않는다', () => {
    const loadFileSizes = vi.fn();
    const opts = options({ directSelection: true, fixedFiles: [{ name: '기존.pdf' }], loadFileSizes });
    const originals = [file(25 * MiB, '원문 숙제.pdf'), file(2, '연습 사진.png', 'image/png')];
    const { result } = renderHook(() => useFileAttach(opts));
    const event = change(originals);
    act(() => result.current.handleDocPickChange(event));
    expect(event.target.value).toBe('');
    expect(opts.onConfirm).toHaveBeenCalledOnce();
    expect(opts.onConfirm).toHaveBeenCalledWith('document', [
      expect.objectContaining({ file: originals[0], baseName: '원문 숙제', ext: '.pdf', category: 'document', source: 'external' }),
      expect.objectContaining({ file: originals[1], baseName: '연습 사진', ext: '.png', category: 'document', source: 'external' }),
    ]);
    opts.onConfirm.mock.calls[0][1].forEach((entry, index) => expect(entry.file).toBe(originals[index]));
    expect(result.current.modalKind).toBe(null);
    expect(result.current.sessionFiles).toEqual([]);
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparationStage).toBe(null);
    expect(loadFileSizes).not.toHaveBeenCalled();
    expectNoPreparation();
  });

  it.each([1, 2])('외부 녹음 %s개는 이름 입력 없이 각 원본 이름으로 바로 전달한다', count => {
    const opts = options({ directSelection: true });
    const originals = [file(8, '첫 음성.wav', 'audio/wav'), file(8, '둘째 음성.m4a', 'audio/mp4')].slice(0, count);
    const { result } = renderHook(() => useFileAttach(opts));
    const event = change(originals);
    act(() => result.current.handleAudioPickChange(event));
    expect(event.target.value).toBe('');
    expect(opts.onConfirm).toHaveBeenCalledOnce();
    const [kind, entries] = opts.onConfirm.mock.calls[0];
    expect(kind).toBe('audio');
    expect(entries).toHaveLength(count);
    entries.forEach((entry, index) => {
      expect(entry.file).toBe(originals[index]);
      expect(entry).toEqual(expect.objectContaining({ baseName: index ? '둘째 음성' : '첫 음성', ext: index ? '.m4a' : '.wav', category: 'audio', source: 'external' }));
    });
    expect(result.current.namingFile).toBe(null);
    expect(result.current.modalKind).toBe(null);
    expect(result.current.sessionFiles).toEqual([]);
    expectNoPreparation();
  });

  it('파일 추가 버튼은 네이티브 선택기만 열고 중간 모달을 열지 않는다', () => {
    const { result } = renderHook(() => useFileAttach(options({ directSelection: true })));
    const audioClick = vi.fn();
    const docClick = vi.fn();
    result.current.audioInputRef.current = { click: audioClick };
    result.current.docInputRef.current = { click: docClick };
    act(() => result.current.tryOpenAudioPicker());
    act(() => result.current.tryOpenDocPicker());
    expect(audioClick).toHaveBeenCalledOnce();
    expect(docClick).toHaveBeenCalledOnce();
    expect(result.current.modalKind).toBe(null);
    expectNoPreparation();
  });

  it.each(['document', 'audio'])('%s 선택 취소는 파일·모달·오류 알림을 만들지 않는다', category => {
    const opts = options({ directSelection: true });
    const { result } = renderHook(() => useFileAttach(opts));
    const event = change([]);
    act(() => category === 'audio' ? result.current.handleAudioPickChange(event) : result.current.handleDocPickChange(event));
    expect(event.target.value).toBe('');
    expect(opts.onConfirm).not.toHaveBeenCalled();
    expect(result.current.modalKind).toBe(null);
    expect(result.current.namingFile).toBe(null);
    expect(result.current.sessionFiles).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
    expectNoPreparation();
  });

  it.each([
    ['document', '숙제.pdf', 'application/pdf'],
    ['audio', '발음.wav', 'audio/wav'],
  ])('%s에서 같은 파일을 다시 선택할 수 있도록 input을 비우고 원본을 새 항목으로 전달한다', (category, name, type) => {
    const opts = options({ directSelection: true });
    const { result } = renderHook(() => useFileAttach(opts));
    const original = file(8, name, type);
    const event = change([original]);
    const select = () => category === 'audio' ? result.current.handleAudioPickChange(event) : result.current.handleDocPickChange(event);
    act(select);
    expect(event.target.value).toBe('');
    event.target.value = 'selected-again';
    act(select);
    expect(event.target.value).toBe('');
    expect(opts.onConfirm).toHaveBeenCalledTimes(2);
    const first = opts.onConfirm.mock.calls[0][1][0];
    const second = opts.onConfirm.mock.calls[1][1][0];
    expect(first.file).toBe(original);
    expect(second.file).toBe(original);
    expect(second).not.toBe(first);
    expectNoPreparation();
  });

  it.each([
    ['document', '숙제.pdf', 'application/pdf'],
    ['audio', '발음.wav', 'audio/wav'],
  ])('%s의 한도 초과 선택은 일부도 추가하지 않고 10번째 파일까지만 허용한다', (category, name, type) => {
    const onConfirm = vi.fn();
    const fixed = Array.from({ length: 9 }, (_, index) => ({ name: `기존${index}.pdf` }));
    const { result, rerender } = renderHook(({ existing }) => useFileAttach(options({ directSelection: true, fixedFiles: existing, onConfirm })), { initialProps: { existing: fixed } });
    const select = event => category === 'audio' ? result.current.handleAudioPickChange(event) : result.current.handleDocPickChange(event);
    const overflow = change([file(8, name, type), file(8, name, type)]);
    act(() => select(overflow));
    expect(overflow.target.value).toBe('');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('10개'));
    const last = file(8, name, type);
    act(() => select(change([last])));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][1][0].file).toBe(last);
    rerender({ existing: [...fixed, { name }] });
    act(() => select(change([last])));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.current.sessionFiles).toEqual([]);
    expectNoPreparation();
  });

  it('바로 녹음은 녹음창만 열고 취소하면 선택 목록 없이 닫힌다', () => {
    const opts = options({ directSelection: true });
    const { result } = renderHook(() => useFileAttach(opts));
    act(() => result.current.tryOpenRecord());
    expect(result.current.modalKind).toBe('audio');
    expect(result.current.modalView).toBe('record');
    act(() => result.current.closeModal());
    expect(result.current.modalKind).toBe(null);
    expect(result.current.sessionFiles).toEqual([]);
    expect(opts.onConfirm).not.toHaveBeenCalled();
    expectNoPreparation();
  });

  it('녹음창에서 사용한 파일은 확정한 이름과 recording 출처를 바로 전달하고 닫는다', () => {
    const opts = options({ directSelection: true });
    const original = file(8, '직접 정한 녹음.webm', 'audio/webm');
    const { result } = renderHook(() => useFileAttach(opts));
    act(() => result.current.tryOpenRecord());
    act(() => result.current.handleRecorderFile(original));
    expect(opts.onConfirm).toHaveBeenCalledOnce();
    expect(opts.onConfirm).toHaveBeenCalledWith('audio', [expect.objectContaining({ file: original, baseName: '직접 정한 녹음', ext: '.webm', category: 'audio', source: 'recording' })]);
    expect(opts.onConfirm.mock.calls[0][1][0].file).toBe(original);
    expect(result.current.modalKind).toBe(null);
    expect(result.current.sessionFiles).toEqual([]);
    expectNoPreparation();
  });

  it('기본 강사 모드의 여러 녹음은 자동 이름으로 세션에 담고 확인 전까지 전달하지 않는다', () => {
    const opts = options();
    const originals = [file(8, '첫 파일.wav', 'audio/wav'), file(8, '둘째 파일.m4a', 'audio/mp4')];
    const { result } = renderHook(() => useFileAttach(opts));
    act(() => result.current.openModal('audio'));
    act(() => result.current.handleAudioPickChange(change(originals)));
    expect(opts.onConfirm).not.toHaveBeenCalled();
    expect(result.current.sessionFiles.map(entry => entry.baseName)).toEqual(['숙제_1', '숙제_2']);
    act(() => result.current.handleSessionConfirm());
    expect(opts.onConfirm).toHaveBeenCalledWith('audio', [
      expect.objectContaining({ file: originals[0], baseName: '숙제_1', source: 'external' }),
      expect.objectContaining({ file: originals[1], baseName: '숙제_2', source: 'external' }),
    ]);
    expectNoPreparation();
  });
});

describe('최종 제출에서 확인·압축·합산 용량 검증', () => {
  it('기존 용량 조회가 끝나기 전에는 파일 준비를 시작하지 않는다', async () => {
    const sizes = deferred();
    const loadFileSizes = vi.fn(() => sizes.promise);
    const onStage = vi.fn();
    const { result } = renderHook(() => useFileAttach(options({ fixedFiles: [{ name: '기존.pdf' }], loadFileSizes })));
    let preparing;
    act(() => { preparing = result.current.prepareForSubmit([row()], { onStage }); });
    expect(result.current.preparing).toBe(true);
    expect(result.current.preparationStage).toBe('checking');
    expect(result.current.preparationMessage).toContain('기존 파일 용량');
    expectNoPreparation();
    let prepared;
    await act(async () => { sizes.resolve({ files: [{ name: '기존.pdf', size: MiB }] }); prepared = await preparing; });
    expect(prepared).toHaveLength(1);
    expect(result.current.preparationStage).toBe(null);
    expect(result.current.preparing).toBe(false);
    expect(onStage.mock.calls.every(([value]) => ['checking', 'preparing', 'compressing'].includes(value.stage))).toBe(true);
  });

  it('fixedFiles의 pending 중복을 제외하고 압축 후 정확히 50MiB까지 허용한다', async () => {
    const pending = [row(file(30 * MiB), { tempId: 'p1', tag: '보존' }), row(file(30 * MiB), { tempId: 'p2' })];
    const { result } = renderHook(() => useFileAttach(options({ fixedFiles: [{ name: '기존.pdf', size: 20 * MiB }, ...pending] })));
    compressExternalFile.mockImplementation(async (original) => file(15 * MiB, original.name));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit(pending); });
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toEqual(expect.objectContaining({ tempId: 'p1', baseName: pending[0].baseName, tag: '보존', ext: '.pdf' }));
    expect(prepared[0].file.size).toBe(15 * MiB);
    expect(pending[0].file.size).toBe(30 * MiB);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('압축 후에도 파일 하나가 20MiB를 넘으면 거절하고 준비 잠금을 해제한다', async () => {
    const pending = [row(file(25 * MiB))];
    const { result } = renderHook(() => useFileAttach(options()));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit(pending); });
    expect(prepared).toBe(null);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('20MB'));
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparationStage).toBe(null);
    compressExternalFile.mockResolvedValueOnce(file(10 * MiB));
    await act(async () => { prepared = await result.current.prepareForSubmit(pending); });
    expect(prepared[0].file.size).toBe(10 * MiB);
    expect(compressExternalFile).toHaveBeenCalledTimes(2);
  });

  it('합산 한도를 넘으면 거절하고, 기존 파일을 삭제한 뒤 같은 준비 결과를 재사용한다', async () => {
    const pending = [row(file(18 * MiB)), row(file(18 * MiB))];
    const { result, rerender } = renderHook(({ existing }) => useFileAttach(options({ fixedFiles: [...existing, ...pending] })), {
      initialProps: { existing: [{ name: '기존.pdf', size: 20 * MiB }] },
    });
    compressExternalFile.mockImplementation(async (original) => file(16 * MiB, original.name));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit(pending); });
    expect(prepared).toBe(null);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('50MB'));
    rerender({ existing: [] });
    await act(async () => { prepared = await result.current.prepareForSubmit(pending); });
    expect(prepared).toHaveLength(2);
    expect(compressExternalFile).toHaveBeenCalledTimes(2);
  });

  it('저장 실패 재시도는 같은 File의 결과만 재사용하고 교체한 File은 다시 준비한다', async () => {
    const original = file(10);
    const pending = [row(original, { tempId: 'first' })];
    const compressed = file(5);
    compressExternalFile.mockResolvedValue(compressed);
    const { result } = renderHook(() => useFileAttach(options()));
    let first;
    let retry;
    await act(async () => { first = await result.current.prepareForSubmit(pending); });
    await act(async () => { retry = await result.current.prepareForSubmit([row(original, { tempId: 'new-id', baseName: '이름 변경' })]); });
    expect(retry[0].file).toBe(first[0].file);
    expect(retry[0]).toEqual(expect.objectContaining({ tempId: 'new-id', baseName: '이름 변경' }));
    expect(compressExternalFile).toHaveBeenCalledTimes(1);
    const replacement = file(10);
    await act(async () => { await result.current.prepareForSubmit([row(replacement)]); });
    expect(compressExternalFile).toHaveBeenCalledTimes(2);
  });

  it('외부 WAV가 MP3로 바뀌면 사용자 이름과 ID는 보존하고 실제 확장자로 반환한다', async () => {
    const original = file(10, 'original.wav', 'audio/wav');
    const pending = [row(original, { tempId: 'audio-id', baseName: '직접 정한 이름', ext: '.wav', category: 'audio' })];
    const output = file(5, 'original.mp3', 'audio/mpeg');
    compressExternalFile.mockResolvedValueOnce(output);
    const { result } = renderHook(() => useFileAttach(options()));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit(pending); });
    expect(ensureCompleteFile).toHaveBeenCalledWith(original);
    expect(prepared[0]).toEqual(expect.objectContaining({ tempId: 'audio-id', baseName: '직접 정한 이름', ext: '.mp3', file: output }));
    expect(pending[0].file).toBe(original);
  });

  it('직접 녹음은 최종 무결성만 확인하고 외부 파일용 압축을 건너뛴다', async () => {
    const original = file(10, 'record.webm', 'audio/webm');
    const pending = [row(original, { category: 'audio', source: 'recording', ext: '.webm' })];
    const { result } = renderHook(() => useFileAttach(options()));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit(pending); });
    expect(prepared[0].file).toBe(original);
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(ensureCompleteFile).toHaveBeenCalledOnce();
  });

  it('안드로이드에서 온전하게 복구된 녹음의 준비 결과도 원본 File 키로 재사용한다', async () => {
    const original = file(10, 'original.m4a', 'audio/mp4');
    const recovered = file(20, 'original.m4a', 'audio/mp4');
    ensureCompleteFile.mockResolvedValueOnce({ ok: true, file: recovered, recovered: true });
    const { result } = renderHook(() => useFileAttach(options()));
    const pending = [row(original, { category: 'audio' })];
    let first;
    let retry;
    await act(async () => { first = await result.current.prepareForSubmit(pending); });
    await act(async () => { retry = await result.current.prepareForSubmit(pending); });
    expect(first[0].file).toBe(recovered);
    expect(retry[0].file).toBe(recovered);
    expect(ensureCompleteFile).toHaveBeenCalledOnce();
    expect(compressExternalFile).toHaveBeenCalledWith(recovered, expect.any(Object));
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it('손상된 녹음은 최종 단계에서 중단하고 압축·업로드용 결과를 반환하지 않는다', async () => {
    ensureCompleteFile.mockResolvedValueOnce({ ok: false, actual: 10, expected: 20 });
    const { result } = renderHook(() => useFileAttach(options()));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit([row(file(10, 'bad.m4a', 'audio/mp4'))]); });
    expect(prepared).toBe(null);
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('녹음이 손상되었어요', { duration: 8000 });
    expect(result.current.preparationStage).toBe(null);
  });

  it('기존 용량 조회 실패 후에도 목록 선택을 막지 않고 다음 최종 제출에서 재조회한다', async () => {
    const loadFileSizes = vi.fn().mockRejectedValueOnce(new Error('조회 실패')).mockResolvedValueOnce({ files: [{ name: '기존.pdf', size: MiB }] });
    const { result } = renderHook(() => useFileAttach(options({ fixedFiles: [{ name: '기존.pdf' }], loadFileSizes })));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit([row()]); });
    expect(prepared).toBe(null);
    expect(result.current.sizeError).toBe(true);
    act(() => result.current.openModal('document'));
    act(() => result.current.handleDocPickChange(change([file()])));
    expect(result.current.sessionFiles).toHaveLength(1);
    expect(loadFileSizes).toHaveBeenCalledTimes(1);
    await act(async () => { prepared = await result.current.prepareForSubmit([row()]); });
    expect(prepared).toHaveLength(1);
    expect(loadFileSizes).toHaveBeenCalledTimes(2);
    expect(result.current.sizeError).toBe(false);
  });

  it('다른 숙제 또는 새 URL의 동명 파일에는 이전 용량 캐시를 적용하지 않는다', async () => {
    const loadFileSizes = vi.fn().mockResolvedValue({ files: [{ name: '기존.pdf', size: MiB }] });
    const { result, rerender } = renderHook(({ scope, url }) => useFileAttach(options({ fixedFiles: [{ name: '기존.pdf', url }], loadFileSizes, attachmentScope: scope })), {
      initialProps: { scope: '숙제1', url: 'first' },
    });
    await act(async () => { await result.current.prepareForSubmit([]); });
    await act(async () => { await result.current.prepareForSubmit([]); });
    expect(loadFileSizes).toHaveBeenCalledTimes(1);
    rerender({ scope: '숙제1', url: 'changed' });
    await act(async () => { await result.current.prepareForSubmit([]); });
    rerender({ scope: '숙제2', url: 'changed' });
    await act(async () => { await result.current.prepareForSubmit([]); });
    expect(loadFileSizes).toHaveBeenCalledTimes(3);
  });

  it('파일이 없어도 기존 용량을 검증하고 1/0 같은 진행 문구는 만들지 않는다', async () => {
    const onStage = vi.fn();
    const { result } = renderHook(() => useFileAttach(options()));
    let prepared;
    await act(async () => { prepared = await result.current.prepareForSubmit([], { onStage }); });
    expect(prepared).toEqual([]);
    expect(onStage.mock.calls.every(([entry]) => entry.detail === '')).toBe(true);
    expectNoPreparation();
  });

  it('단계 콜백은 객체로 전달하고 실패·지연 콜백을 정리한다', async () => {
    const ready = deferred();
    let notifyStage;
    compressExternalFile.mockImplementationOnce((_file, opts) => { notifyStage = opts.onStage; return ready.promise; });
    const onStage = vi.fn();
    const { result } = renderHook(() => useFileAttach(options()));
    let preparing;
    act(() => { preparing = result.current.prepareForSubmit([row()], { onStage }); });
    await waitFor(() => expect(notifyStage).toBeTypeOf('function'));
    act(() => notifyStage('compressing'));
    expect(result.current.preparationStage).toBe('compressing');
    expect(onStage).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'compressing', detail: '1/1개 파일 준비 중' }));
    await act(async () => { ready.reject(new Error('준비 실패')); await preparing; });
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparationStage).toBe(null);
    const calls = onStage.mock.calls.length;
    act(() => notifyStage('compressing'));
    expect(onStage).toHaveBeenCalledTimes(calls);
    expect(result.current.preparationStage).toBe(null);
  });

  it('페이지 이탈 시 압축을 취소하고 늦은 파일과 단계·오류 알림을 버린다', async () => {
    const ready = deferred();
    let signal;
    let notifyStage;
    compressExternalFile.mockImplementationOnce((_file, opts) => { signal = opts.signal; notifyStage = opts.onStage; return ready.promise; });
    const onStage = vi.fn();
    const { result, unmount } = renderHook(() => useFileAttach(options()));
    let preparing;
    act(() => { preparing = result.current.prepareForSubmit([row()], { onStage }); });
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    const calls = onStage.mock.calls.length;
    notifyStage('compressing');
    expect(signal.aborted).toBe(true);
    let prepared;
    await act(async () => { ready.resolve(file()); prepared = await preparing; });
    expect(prepared).toBe(null);
    expect(onStage).toHaveBeenCalledTimes(calls);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('명시 취소 직후 새 파일 선택과 준비가 가능하며 이전 완료가 새 단계를 덮지 않는다', async () => {
    const oldReady = deferred();
    const newReady = deferred();
    const callbacks = [];
    const signals = [];
    compressExternalFile.mockImplementation((_file, opts) => {
      callbacks.push(opts.onStage);
      signals.push(opts.signal);
      return callbacks.length === 1 ? oldReady.promise : newReady.promise;
    });
    const { result } = renderHook(() => useFileAttach(options()));
    let oldPreparing;
    act(() => { oldPreparing = result.current.prepareForSubmit([row()]); });
    await waitFor(() => expect(callbacks).toHaveLength(1));
    act(() => result.current.cancelPreparation());
    expect(signals[0].aborted).toBe(true);
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparationStage).toBe(null);
    act(() => result.current.handleDocPickChange(change([file(2, 'new.pdf')])));
    expect(result.current.sessionFiles).toHaveLength(1);
    let newPreparing;
    act(() => { newPreparing = result.current.prepareForSubmit([row(file(2, 'new.pdf'))]); });
    await waitFor(() => expect(callbacks).toHaveLength(2));
    act(() => callbacks[1]('checking'));
    act(() => callbacks[0]('compressing'));
    expect(result.current.preparationStage).toBe('checking');
    await act(async () => { oldReady.resolve(file()); expect(await oldPreparing).toBe(null); });
    expect(result.current.preparing).toBe(true);
    expect(result.current.preparationStage).toBe('checking');
    await act(async () => { newReady.resolve(file(2, 'new.pdf')); expect(await newPreparing).toHaveLength(1); });
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparationStage).toBe(null);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('여러 파일은 30초 압축 예산을 공유하고 시간이 지나면 원본으로 최종 검증한다', async () => {
    vi.useFakeTimers();
    let signal;
    compressExternalFile.mockImplementationOnce((original, opts) => new Promise((resolve) => {
      signal = opts.signal;
      signal.addEventListener('abort', () => resolve(original), { once: true });
    }));
    const { result } = renderHook(() => useFileAttach(options()));
    let preparing;
    await act(async () => { preparing = result.current.prepareForSubmit([row(), row()]); });
    expect(signal).toBeDefined();
    let prepared;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); prepared = await preparing; });
    expect(signal.aborted).toBe(true);
    expect(prepared).toHaveLength(2);
    expect(compressExternalFile).toHaveBeenCalledOnce();
    expect(result.current.preparing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
