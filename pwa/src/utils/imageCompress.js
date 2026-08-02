// 사진 업로드 전 자동 축소 — 요즘 폰 사진은 3~8MB라 Notion 무료 워크스페이스의
// 파일당 5MB 상한에 그대로 걸린다. 숙제 사진은 "읽을 수 있으면" 되므로 장변 1600px·JPEG로
// 줄여 보통 1MB 이하로 만든다. 업로드 시간도 함께 짧아져 모바일 회선에서 타임아웃 위험이 준다.
//
// 원칙:
// - 실패하면 원본을 그대로 돌려준다 (압축은 최적화일 뿐, 제출을 막는 관문이 아니다).
// - 결과가 원본보다 크면 원본을 쓴다 (작은 png 등에서 역효과 방지).
// - PDF·GIF는 대상이 아니다. HEIC는 브라우저가 디코드하지 못하면 원본 유지.

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
// 이보다 작으면 손대지 않는다 — 이미 가벼운 사진을 재인코딩해 화질만 깎을 이유가 없다.
const SKIP_UNDER_BYTES = 1024 * 1024;

function isCompressibleImage(file) {
  const type = (file?.type || '').toLowerCase().split(';')[0].trim();
  if (type === 'image/gif') return false; // 애니메이션이 죽는다
  if (type.startsWith('image/')) return true;
  // MIME이 비어 오는 환경(일부 안드로이드·Windows) 대비 — 확장자로 판정
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file?.name || '');
}

/** 장변 기준 축소 비율 — 이미 작으면 1(축소 안 함) */
export function scaleFor(width, height, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  return longest > maxEdge ? maxEdge / longest : 1;
}

/**
 * 이미지 파일을 장변 1600px·JPEG로 축소. 압축 대상이 아니거나 실패하면 원본을 그대로 반환한다.
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function compressImage(file) {
  if (!file || !isCompressibleImage(file)) return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap;
  try {
    // imageOrientation: EXIF 회전을 반영해 눕혀진 사진이 그대로 저장되는 걸 막는다.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // HEIC 등 디코드 불가 — 원본 유지
  }

  try {
    const scale = scaleFor(bitmap.width, bitmap.height);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    if (!blob || blob.size >= file.size) return file; // 이득 없으면 원본

    const base = (file.name || 'photo').replace(/\.[^/.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
