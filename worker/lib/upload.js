// 숙제 파일 업로드 검증 — 순수 함수 (외부 의존성 없음, 테스트 가능)
//
// 학생 PWA `accept` 속성은 UI 힌트일 뿐이므로 서버측에서 size/MIME을
// 화이트리스트로 강제한다. 우회 업로드(exe/zip 등) 차단 + Notion API의
// single_part 20 MiB 상한을 사전 차단해 모호한 502 응답을 막는 목적.

// Notion file_uploads single_part 모드의 공식 상한.
// 이보다 크면 multi_part 모드가 필요한데 학생용엔 오버스펙이라 단순 거부.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
// 호환을 위해 옛 이름도 유지 (외부 import 가능성)
export const MAX_AUDIO_BYTES = MAX_FILE_BYTES;

// === 파일 카테고리 ===
// 학생/강사는 두 카테고리의 파일을 업로드할 수 있다:
// - audio: 녹음 파일 (mp3/m4a/wav/webm/ogg/aac/opus/flac)
// - document: 이미지·PDF (png/jpeg/jpg/webp/gif/heic + pdf)
// 카테고리는 PWA에서 섹션·플로우를 분리하기 위해 사용되며 Worker는 모든 카테고리를 한 곳에 저장한다.

const AUDIO_MIME = new Set([
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

const DOCUMENT_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',      // 비표준 alias
  'image/webp',     // 모바일 캡처 다수
  'image/gif',
  'image/heic',     // iOS 사진 기본
  'image/heif',
]);

const ALLOWED_MIME = new Set([...AUDIO_MIME, ...DOCUMENT_MIME]);

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'm4a', 'mp4', 'aac', 'webm', 'ogg', 'opus', 'wav', 'flac',
]);

const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif',
]);

const ALLOWED_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);

const FALLBACK_MIMES = new Set(['', 'application/octet-stream', 'application/binary']);

// 비표준·alias MIME → IANA 표준 MIME 매핑.
// validateFileUpload 화이트리스트엔 통과시키지만, Notion file_uploads single_part API 는
// 비표준 mime(`audio/m4a`, `audio/x-m4a` 등)을 거부하는 경우가 있어 업로드 직전에 표준으로 정규화한다.
// (macOS Safari·iOS Safari 등 일부 환경이 m4a 파일에 `audio/m4a`를 붙여 보냄)
const MIME_NORMALIZE = {
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/x-flac': 'audio/flac',
  'image/jpg': 'image/jpeg',
};

// 확장자 → 표준 MIME. Notion에 업로드할 때 type을 정확히 맞추기 위한 폴백.
// MediaRecorder의 `audio/webm;codecs=opus` 같은 비표준 표기나 OS가 MIME을 모르는
// 경우(Windows의 `.webm` 등) 파일 이름으로 보정한다.
const EXT_TO_MIME = {
  // audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
  // document
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
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
 * - file.type이 비표준(alias)이면 표준 MIME 으로 정규화 (audio/m4a → audio/mp4 등)
 * - 표준이면 그대로 (codec 파라미터만 strip)
 * - 비어있거나 generic이면 확장자 기반으로 보정
 * - 그래도 못 찾으면 application/octet-stream 폴백
 */
export function resolveFileMime(file) {
  const base = baseMimeOf(file?.type);
  if (base && !FALLBACK_MIMES.has(base)) {
    return MIME_NORMALIZE[base] || base;
  }
  const ext = extOf(file?.name);
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}
// 호환 별칭
export const resolveAudioMime = resolveFileMime;

/**
 * 파일 카테고리 분류 — 'audio' | 'document' | null.
 * 검증 통과한 파일에 대해 호출. PWA/Worker 모두 같은 분류 기준을 사용해야 한다.
 */
export function fileCategoryOf(file) {
  const mime = baseMimeOf(file?.type);
  if (AUDIO_MIME.has(mime)) return 'audio';
  if (DOCUMENT_MIME.has(mime)) return 'document';
  const ext = extOf(file?.name);
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return null;
}

/**
 * 학생/강사 숙제 파일 업로드 검증 — 음성·이미지·PDF 모두 허용.
 *
 * @param {File|Blob & {name?: string, type?: string, size?: number}} file
 * @returns {{ ok: true, category: 'audio'|'document' } | { ok: false, status: number, error: string }}
 */
export function validateFileUpload(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, status: 400, error: '파일이 없습니다.' };
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, error: '파일이 비어있거나 손상되었습니다.' };
  }
  if (size > MAX_FILE_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      status: 413,
      error: `파일이 너무 큽니다 (${mb} MB). 20 MB 이하로 압축해 다시 시도해주세요.`,
    };
  }

  const mime = baseMimeOf(file.type);
  const ext = extOf(file.name);

  // 1차: MIME 화이트리스트
  if (ALLOWED_MIME.has(mime)) {
    return { ok: true, category: AUDIO_MIME.has(mime) ? 'audio' : 'document' };
  }

  // 2차: MIME이 누락/제네릭한 경우 확장자로 fallback
  if (FALLBACK_MIMES.has(mime) && ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: true, category: AUDIO_EXTENSIONS.has(ext) ? 'audio' : 'document' };
  }

  return {
    ok: false,
    status: 415,
    error: '지원하지 않는 파일 형식입니다. 녹음(mp3/m4a/wav/webm/ogg/aac/flac) 또는 이미지·PDF(png/jpg/webp/gif/heic/pdf)만 가능합니다.',
  };
}

// 호환 별칭 (호출처 이름이 옛 이름인 경우)
export const validateAudioUpload = validateFileUpload;

/**
 * 파일 이름 중복 제거 — 같은 이름이 둘 이상이면 두 번째부터 ` (2)`, ` (3)` 접미사를 붙여 유일화한다.
 * 확장자는 보존한다: `사진.jpg`, `사진.jpg` → `사진.jpg`, `사진 (2).jpg`.
 *
 * 왜 필요한가: 다운로드·미리보기 라우트가 파일을 **이름으로** 식별하는데(노션 files 속성은 동명
 * 파일을 허용함), 동명 파일이 있으면 `files.find(f => f.name === name)` 가 항상 첫 번째만 반환해
 * 서로 다른 파일이 전부 같은 파일로 보이는 버그가 생긴다. 업로드/병합 시점에 이름을 유일화해 방지.
 * 비교는 대소문자 무시(노션·OS 파일명 관행).
 *
 * @param {string[]} names  순서가 보존된 파일 이름 배열
 * @returns {string[]}      같은 길이·순서로 유일화된 이름 배열
 */
export function dedupeFileNames(names) {
  const used = new Set();
  const out = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = (typeof raw === 'string' && raw) ? raw : 'file';
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const hasExt = dot > 0 && dot < name.length - 1;
      const base = hasExt ? name.slice(0, dot) : name;
      const ext = hasExt ? name.slice(dot) : '';
      let n = 2;
      do {
        candidate = `${base} (${n})${ext}`;
        n += 1;
      } while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    out.push(candidate);
  }
  return out;
}
