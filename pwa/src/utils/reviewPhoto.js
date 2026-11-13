import { scaleFor } from './imageCompress.js';

export const MAX_REVIEW_PHOTOS = 5;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = 'JPG, PNG, WebP';

async function decodePhoto(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareReviewPhoto(file) {
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('20MB 이하의 사진을 선택해 주세요.');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...header.slice(start, end));
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const png = header[0] === 137 && ascii(1, 8) === 'PNG\r\n\x1a\n';
  const webp = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error(`${ACCEPTED_TYPES} 사진만 첨부할 수 있어요.`);

  const image = await decodePhoto(file).catch(() => { throw new Error('사진을 열지 못했어요. 다른 사진을 선택해 주세요.'); });
  const canvas = document.createElement('canvas');
  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = scaleFor(width, height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('이 기기에서 사진을 준비하지 못했어요.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Canvas encoding drops source metadata, including embedded location.
    for (const quality of [0.84, 0.7, 0.55]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob?.type === 'image/jpeg' && blob.size && blob.size <= MAX_PHOTO_BYTES) {
        return new File([blob], `review-photo-${crypto.randomUUID()}.jpg`, { type: 'image/jpeg' });
      }
    }
    throw new Error('더 작은 사진으로 다시 시도해 주세요.');
  } finally {
    image.close?.();
    canvas.width = 0;
    canvas.height = 0;
  }
}
