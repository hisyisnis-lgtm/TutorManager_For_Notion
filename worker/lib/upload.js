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

// 확장자 → 표준 MIME. Notion에 업로드할 때 type을 정확히 맞추기 위한 폴백.
// MediaRecorder의 `audio/webm;codecs=opus` 같은 비표준 표기나 OS가 MIME을 모르는
// 경우 (Windows의 `.webm` 등) 파일 이름으로 보정한다.
const EXT_TO_MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

export function extOf(name) {
  if (typeof name !== 'string') return '';
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

// `audio/webm;codecs=opus` → `audio/webm`. MIME 파라미터 stripping은 RFC 7231 표준.
export function baseMimeOf(type) {
  if (typeof type !== 'string') return '';
  const semi = type.indexOf(';');
  const base = semi >= 0 ? type.slice(0, semi) : type;
  return base.toLowerCase().trim();
}

/**
 * Notion 업로드에 안전한 MIME 도출.
 * - file.type이 표준이면 그대로 (codec 파라미터만 strip)
 * - 비어있거나 generic이면 확장자 기반으로 보정
 * - 그래도 못 찾으면 audio/mpeg 폴백 (Notion이 가장 보편적으로 받는 audio MIME)
 */
export function resolveAudioMime(file) {
  const base = baseMimeOf(file?.type);
  if (base && !FALLBACK_MIMES.has(base)) return base;
  const ext = extOf(file?.name);
  return EXT_TO_MIME[ext] || 'audio/mpeg';
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

  // MediaRecorder는 `audio/webm;codecs=opus` 같은 형태로 codec 파라미터를 붙인다.
  // RFC 7231 기준 파라미터는 옵셔널이므로 base MIME만 비교한다.
  const mime = baseMimeOf(file.type);
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
