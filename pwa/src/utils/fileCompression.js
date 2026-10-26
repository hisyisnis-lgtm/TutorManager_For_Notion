/* global Worker */
// 외부에서 고른 큰 파일만 처리한다. 직접 녹음·사진 축소는 각 기존 경로를 사용한다.
export const EXTERNAL_COMPRESSION_MIN_BYTES = 5 * 1024 * 1024;
export const EXTERNAL_COMPRESSION_TIMEOUT_MS = 30_000;
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 20 * 60;
const AUDIO_SAMPLE_RATE = 44_100;
const MAX_PCM_BYTES = 160 * 1024 * 1024;
const MIN_SAVING_RATIO = 0.9;

function fileKind(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type.startsWith('audio/') || /\.(?:mp3|m4a|aac|wav|ogg|oga|webm|flac|aiff?|opus)$/i.test(file.name)) return 'audio';
  return null;
}

// 디코드 전에 길이를 확인해 압축된 장시간 녹음이 큰 PCM 버퍼로 풀리는 것을 막는다.
function readAudioDuration(file, cleanups) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let timer;
    const done = (duration = null) => {
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      cleanups.delete(cancel);
      resolve(duration);
    };
    const cancel = () => done();
    cleanups.add(cancel);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done();
    timer = setTimeout(cancel, 2500);
    audio.src = url;
  });
}

/**
 * 압축 효과가 10% 이상일 때만 새 File을 반환한다. 지원 불가·실패·취소는 원본 반환.
 * onProgress: 0~1, onStage: 실제 확인/준비/압축 단계와 종료 시 null.
 * signal: 모달 닫기/전체 준비 시간 초과 시 취소하는 AbortSignal.
 */
export function compressExternalFile(file, { onProgress, onStage, signal } = {}) {
  const kind = fileKind(file);
  if (!kind || file.size < EXTERNAL_COMPRESSION_MIN_BYTES || file.size > MAX_INPUT_BYTES
    || typeof Worker === 'undefined' || signal?.aborted) return Promise.resolve(file);

  return new Promise((resolve) => {
    const cleanups = new Set();
    let finished = false;
    let worker;
    let currentStage = null;
    const stage = (value) => {
      if (finished || currentStage === value) return;
      currentStage = value;
      try { onStage?.(value); } catch { /* 표시 콜백은 파일 준비 결과에 영향을 주지 않는다. */ }
    };
    const progress = (value) => {
      if (!finished) {
        try { onProgress?.(value); } catch { /* 알림 콜백이 첨부를 실패시키지 않는다. */ }
      }
    };
    const finish = (result = file) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker?.terminate();
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
      if (currentStage !== null) {
        try { onStage?.(null); } catch { /* 표시 콜백 오류에도 원본 복귀를 보장한다. */ }
      }
      resolve(result);
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, EXTERNAL_COMPRESSION_TIMEOUT_MS);
    signal?.addEventListener('abort', cancel, { once: true });

    const startWorker = (instance, payload, transfers = []) => {
      // Worker 생성은 각 분기 안의 정적 new URL로 남겨 Vite가 자산 경로를 분석한다.
      worker = instance;
      worker.onmessage = ({ data }) => {
        if (finished) return;
        if (data.stage) { stage(data.stage); return; }
        if (data.progress !== undefined) { progress(0.2 + data.progress * 0.75); return; }
        if (!data.bytes || data.bytes.byteLength > file.size * MIN_SAVING_RATIO || !data.bytes.byteLength) {
          finish();
          return;
        }
        const name = kind === 'audio' ? file.name.replace(/\.[^.]+$/, '') + '.mp3' : file.name;
        const result = new File([data.bytes], name, {
          type: kind === 'audio' ? 'audio/mpeg' : 'application/pdf', lastModified: file.lastModified,
        });
        progress(1);
        finish(result);
      };
      worker.onerror = cancel;
      worker.onmessageerror = cancel;
      worker.postMessage(payload, transfers);
    };

    (async () => {
      try {
        progress(0);
        if (kind === 'pdf') {
          if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') { finish(); return; }
          stage('checking');
          startWorker(new Worker(new URL('./fileCompressionPdf.worker.js', import.meta.url), { type: 'module' }), { file });
          return;
        }
        const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
        if (!OfflineContext) { finish(); return; }
        stage('checking');
        const duration = await readAudioDuration(file, cleanups);
        if (finished) return;
        if (!duration || duration > MAX_AUDIO_SECONDS || duration * AUDIO_SAMPLE_RATE * 2 * 4 > MAX_PCM_BYTES) {
          finish(); return;
        }
        const input = await file.arrayBuffer();
        if (finished) return;
        stage('preparing');
        const context = new OfflineContext(1, 1, AUDIO_SAMPLE_RATE);
        const decoded = await context.decodeAudioData(input);
        if (finished) return;
        const channels = decoded.numberOfChannels;
        if (channels < 1 || channels > 2 || decoded.duration > MAX_AUDIO_SECONDS
          || decoded.length * channels * 4 > MAX_PCM_BYTES) { finish(); return; }
        const kbps = channels === 1 ? 64 : 96;
        // 이미 저용량인 MP3/M4A를 다시 인코딩하느라 기다리거나 음질을 떨어뜨리지 않는다.
        if ((decoded.duration * kbps * 125) > file.size * MIN_SAVING_RATIO) { finish(); return; }
        const samples = Array.from({ length: channels }, (_, i) => decoded.getChannelData(i));
        progress(0.2);
        startWorker(new Worker(new URL('./fileCompressionAudio.worker.js', import.meta.url), { type: 'module' }),
          { samples, sampleRate: decoded.sampleRate, kbps }, samples.map((channel) => channel.buffer));
      } catch {
        finish();
      }
    })();
  });
}
