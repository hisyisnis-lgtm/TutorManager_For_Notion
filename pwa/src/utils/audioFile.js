// 숙제 음성 파일 검증·확장자 처리 — 클라이언트측 사전 차단.
//
// 서버(`worker/lib/upload.js`)도 동일 화이트리스트로 강제하지만, 클라이언트에서
// 미리 막아 친절한 에러 메시지를 띄우고 무의미한 업로드 트래픽을 줄인다.
// 화이트리스트가 바뀌면 worker/lib/upload.js와 함께 동기화할 것.

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // Notion file_uploads single_part 상한

const ALLOWED_MIME = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/aac',
  'audio/webm',
  'audio/ogg', 'audio/opus',
  'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/flac', 'audio/x-flac',
]);

const ALLOWED_EXTENSIONS = new Set([
  'mp3', 'm4a', 'mp4', 'aac', 'webm', 'ogg', 'opus', 'wav', 'flac',
]);

const FALLBACK_MIMES = new Set(['', 'application/octet-stream', 'application/binary']);

/**
 * 파일 이름을 base + ext(점 포함, 소문자)로 분리.
 * 확장자가 없으면 ext는 빈 문자열.
 */
export function splitFileName(name) {
  if (typeof name !== 'string') return { base: '', ext: '' };
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return { base: name, ext: '' };
  return {
    base: name.slice(0, idx),
    ext: name.slice(idx).toLowerCase(),
  };
}

/**
 * 학생/강사 숙제 파일 업로드 사전 검증.
 *
 * @param {File} file
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateAudioFile(file) {
  if (!file) return { ok: false, error: '파일을 선택해주세요.' };

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: '파일이 비어있거나 손상되었습니다.' };
  }
  if (size > MAX_AUDIO_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `파일이 너무 커요 (${mb} MB). 20 MB 이하로 줄여서 다시 시도해주세요.`,
    };
  }

  // MediaRecorder는 `audio/webm;codecs=opus` 형태로 codec 파라미터를 붙인다.
  // RFC 7231 기준 파라미터는 옵셔널 — base MIME만으로 비교해 통과시켜야 한다.
  const rawType = (file.type || '').toLowerCase().trim();
  const semi = rawType.indexOf(';');
  const mime = semi >= 0 ? rawType.slice(0, semi).trim() : rawType;
  if (ALLOWED_MIME.has(mime)) return { ok: true };

  const { ext } = splitFileName(file.name || '');
  const extNoDot = ext.startsWith('.') ? ext.slice(1) : ext;
  if (FALLBACK_MIMES.has(mime) && ALLOWED_EXTENSIONS.has(extNoDot)) return { ok: true };

  return {
    ok: false,
    error: '오디오 파일만 업로드할 수 있어요 (mp3, m4a, wav, webm, ogg, aac, flac).',
  };
}
