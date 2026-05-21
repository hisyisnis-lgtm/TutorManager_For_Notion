// 숙제 파일 검증·확장자·카테고리 분류 — 클라이언트측 사전 차단.
//
// 서버(`worker/lib/upload.js`)도 동일 화이트리스트로 강제하지만, 클라이언트에서
// 미리 막아 친절한 에러 메시지를 띄우고 무의미한 업로드 트래픽을 줄인다.
// 화이트리스트가 바뀌면 worker/lib/upload.js와 함께 동기화할 것.

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // Notion file_uploads single_part 상한
// 옛 이름 호환 alias (호출처에서 import 하는 곳 보호)
export const MAX_AUDIO_BYTES = MAX_FILE_BYTES;

// === 카테고리별 MIME / 확장자 ===

const AUDIO_MIME = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/aac',
  'audio/webm',
  'audio/ogg', 'audio/opus',
  'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/flac', 'audio/x-flac',
]);

const DOCUMENT_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg', 'image/jpg',
  'image/webp',
  'image/gif',
  'image/heic', 'image/heif',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'm4a', 'mp4', 'aac', 'webm', 'ogg', 'opus', 'wav', 'flac',
]);

const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif',
]);

const ALLOWED_MIME = new Set([...AUDIO_MIME, ...DOCUMENT_MIME]);
const ALLOWED_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);

const FALLBACK_MIMES = new Set(['', 'application/octet-stream', 'application/binary']);

// `<input accept>` 속성값 — 카테고리별로 다르게 노출해 OS 파일 picker 단계에서부터 필터링.
// 와일드카드 `audio/*` 외에 확장자도 명시해야 iOS Safari 호환이 좋다.
export const ACCEPT_AUDIO = 'audio/*,.mp3,.m4a,.mp4,.wav,.aac,.ogg,.webm,.opus,.flac';
export const ACCEPT_DOCUMENT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif';

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

function normalizedMime(file) {
  const rawType = (file?.type || '').toLowerCase().trim();
  const semi = rawType.indexOf(';');
  return semi >= 0 ? rawType.slice(0, semi).trim() : rawType;
}

function extNoDotOf(file) {
  const { ext } = splitFileName(file?.name || '');
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

/**
 * 파일을 'audio' / 'document' / null 로 분류.
 * 검증 통과한 파일에 대해 호출 (또는 표시 컴포넌트에서 분기 용도).
 */
export function fileCategoryOf(file) {
  const mime = normalizedMime(file);
  if (AUDIO_MIME.has(mime)) return 'audio';
  if (DOCUMENT_MIME.has(mime)) return 'document';
  const ext = extNoDotOf(file);
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return null;
}

/**
 * 파일명으로 카테고리 추정 (이미 업로드된 Notion file 객체용 — file.type 정보 없음).
 */
export function fileCategoryByName(name) {
  if (!name) return null;
  const idx = name.lastIndexOf('.');
  if (idx < 0) return null;
  const ext = name.slice(idx + 1).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return null;
}

/**
 * 파일이 이미지 카테고리인지 (PDF는 false). FilePreview 렌더 분기용.
 */
export function isImageByName(name) {
  if (!name) return false;
  const idx = name.lastIndexOf('.');
  if (idx < 0) return false;
  const ext = name.slice(idx + 1).toLowerCase();
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].includes(ext);
}

export function isPdfByName(name) {
  if (!name) return false;
  return name.toLowerCase().endsWith('.pdf');
}

/**
 * 학생/강사 숙제 파일 업로드 사전 검증.
 * 카테고리(audio/document)가 한정된 모달에서 호출할 때는 expectedCategory로 추가 제약 가능.
 *
 * @param {File} file
 * @param {{ expectedCategory?: 'audio'|'document' }} [opts]
 * @returns {{ ok: true, category: 'audio'|'document' } | { ok: false, error: string }}
 */
export function validateFile(file, opts = {}) {
  if (!file) return { ok: false, error: '파일을 선택해주세요.' };

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: '파일이 비어있거나 손상되었습니다.' };
  }
  if (size > MAX_FILE_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `파일이 너무 커요 (${mb} MB). 20 MB 이하로 줄여서 다시 시도해주세요.`,
    };
  }

  const mime = normalizedMime(file);
  const ext = extNoDotOf(file);

  let category = null;
  if (ALLOWED_MIME.has(mime)) {
    category = AUDIO_MIME.has(mime) ? 'audio' : 'document';
  } else if (FALLBACK_MIMES.has(mime) && ALLOWED_EXTENSIONS.has(ext)) {
    category = AUDIO_EXTENSIONS.has(ext) ? 'audio' : 'document';
  }

  if (!category) {
    return {
      ok: false,
      error: '지원하지 않는 파일이에요. 녹음(mp3·m4a·wav 등) 또는 이미지·PDF(png·jpg·webp·pdf 등)만 가능해요.',
    };
  }

  if (opts.expectedCategory && opts.expectedCategory !== category) {
    if (opts.expectedCategory === 'audio') {
      return { ok: false, error: '이 자리는 녹음 파일만 올릴 수 있어요. (이미지·PDF는 아래 섹션에서 올려주세요)' };
    }
    return { ok: false, error: '이 자리는 이미지·PDF만 올릴 수 있어요. (녹음은 위 섹션에서 올려주세요)' };
  }

  return { ok: true, category };
}

// 옛 이름 호환 alias — 카테고리 제한 없이 audio만 허용하던 호출처가 있다면 점진 마이그레이션.
export function validateAudioFile(file) {
  return validateFile(file, { expectedCategory: 'audio' });
}
