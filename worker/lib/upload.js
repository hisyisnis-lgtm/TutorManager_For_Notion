// 숙제 파일 업로드 검증 — 순수 함수 (외부 의존성 없음, 테스트 가능)
//
// 학생 PWA `accept="audio/*"`는 UI 힌트일 뿐이므로 서버측에서 size/MIME을
// 화이트리스트로 강제한다. 우회 업로드(PDF/exe 등) 차단 + Notion API의
// single_part 20 MiB 상한을 사전 차단해 모호한 502 응답을 막는 목적.

// Notion file_uploads single_part 모드의 공식 상한.
// 이보다 크면 multi_part 모드가 필요한데 학생용엔 오버스펙이라 단순 거부.
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

// MIME 화이트리스트. 모바일 녹음·DAW 익스포트에서 흔히 보이는 audio/* 만 허용.
// 일부 브라우저가 보내는 비표준 alias도 포함 (Safari `audio/x-m4a`, Chrome `audio/aac` 등).
const ALLOWED_MIME = new Set([
  'audio/mpeg',     // .mp3
  'audio/mp3',      // 비표준이지만 일부 브라우저
  'audio/mp4',      // .m4a, .mp4 audio container
  'audio/m4a',      // alias
  'audio/x-m4a',    // Safari
  'audio/aac',      // .aac
  'audio/webm',     // MediaRecorder webm
  'audio/ogg',      // .ogg
  'audio/opus',     // .opus
  'audio/wav',      // .wav
  'audio/wave',     // alias
  'audio/x-wav',    // alias
  'audio/flac',     // .flac
  'audio/x-flac',   // alias
]);

// 일부 모바일 브라우저는 MIME을 누락(`''`)하거나 `application/octet-stream`으로 보낸다.
// 이 경우 fallback으로 확장자만 보고 통과시킨다 (학생 UX 보호).
const ALLOWED_EXTENSIONS = new Set([
  'mp3', 'm4a', 'mp4', 'aac', 'webm', 'ogg', 'opus', 'wav', 'flac',
]);

const FALLBACK_MIMES = new Set(['', 'application/octet-stream', 'application/binary']);

function extOf(name) {
  if (typeof name !== 'string') return '';
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

/**
 * 학생/강사 숙제 파일 업로드 검증.
 *
 * @param {File|Blob & {name?: string, type?: string, size?: number}} file
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function validateAudioUpload(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, status: 400, error: '파일이 없습니다.' };
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, error: '파일이 비어있거나 손상되었습니다.' };
  }
  if (size > MAX_AUDIO_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      status: 413,
      error: `파일이 너무 큽니다 (${mb} MB). 20 MB 이하로 압축해 다시 시도해주세요.`,
    };
  }

  const mime = (typeof file.type === 'string' ? file.type : '').toLowerCase().trim();
  const ext = extOf(file.name);

  // 1차: MIME 화이트리스트
  if (ALLOWED_MIME.has(mime)) return { ok: true };

  // 2차: MIME이 누락/제네릭한 경우 확장자로 fallback
  if (FALLBACK_MIMES.has(mime) && ALLOWED_EXTENSIONS.has(ext)) return { ok: true };

  return {
    ok: false,
    status: 415,
    error: '오디오 파일만 업로드할 수 있습니다 (mp3, m4a, wav, webm, ogg, aac, flac).',
  };
}
