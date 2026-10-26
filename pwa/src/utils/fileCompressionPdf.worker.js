/* global self */
import { PDFArray, PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';

const name = PDFName.of;
const MIN_JPEG_BYTES = 256 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_TOTAL_PIXELS = 48_000_000;

function containsSignature(object) {
  if (object instanceof PDFDict) {
    if (object.has(name('ByteRange')) || object.get(name('Type')) === name('Sig') || object.get(name('FT')) === name('Sig')) return true;
    return object.entries().some(([, value]) => containsSignature(value));
  }
  return object instanceof PDFArray && object.asArray().some(containsSignature);
}

// 페이지를 그림으로 다시 만들지 않는다. 텍스트·벡터·필기·링크·양식을 그대로 두고,
// 일반 RGB JPEG 이미지 스트림만 같은 해상도에서 재압축한다.
export async function optimizePdf(file, reportProgress = () => {}, reportStage = () => {}) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  const document = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false, throwOnInvalidObject: true });
  if (document.isEncrypted) return null;
  const objects = document.context.enumerateIndirectObjects();
  // 재저장은 전자서명을 무효화한다. 서명 필드나 ByteRange가 있으면 파일 전체를 보존한다.
  if (document.catalog.has(name('Perms')) || objects.some(([, object]) => containsSignature(object))) return null;

  let changed = false;
  let totalPixels = 0;
  for (let index = 0; index < objects.length; index++) {
    const [ref, object] = objects[index];
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    if (dict.get(name('Subtype')) !== name('Image') || dict.get(name('Filter')) !== name('DCTDecode')
      || dict.get(name('ColorSpace')) !== name('DeviceRGB')
      || dict.get(name('BitsPerComponent'))?.asNumber?.() !== 8
      || ['SMask', 'Mask', 'Decode', 'DecodeParms', 'ImageMask', 'SMaskInData', 'Alternates', 'OPI', 'Intent', 'F']
        .some((key) => dict.has(name(key)))) continue;
    const width = dict.get(name('Width'))?.asNumber?.();
    const height = dict.get(name('Height'))?.asNumber?.();
    const pixels = width * height;
    const jpeg = object.getContents();
    if (jpeg.length < MIN_JPEG_BYTES || !Number.isFinite(pixels) || width <= 0 || height <= 0
      || pixels > MAX_IMAGE_PIXELS || totalPixels + pixels > MAX_TOTAL_PIXELS) continue;
    totalPixels += pixels;
    let bitmap;
    let canvas;
    try {
      bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }), { imageOrientation: 'none' });
      // EXIF 등의 방향/치수 해석이 다르면 페이지상의 배치를 바꿀 수 있으므로 건너뛴다.
      if (bitmap.width !== width || bitmap.height !== height) continue;
      canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) continue;
      reportStage('compressing');
      context.drawImage(bitmap, 0, 0);
      const compressed = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
      if (compressed.type !== 'image/jpeg' || compressed.size >= jpeg.length * 0.9) continue;
      const bytes = new Uint8Array(await compressed.arrayBuffer());
      const replacement = dict.clone(document.context);
      replacement.set(name('Length'), PDFNumber.of(bytes.length));
      document.context.assign(ref, PDFRawStream.of(replacement, bytes));
      changed = true;
    } catch {
      // 한 이미지가 지원되지 않아도 문서 전체를 손상시키지 않는다.
    } finally {
      bitmap?.close();
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
    reportProgress((index + 1) / objects.length);
  }
  if (!changed) return null;
  return document.save({ useObjectStreams: true, updateFieldAppearances: false });
}

self.onmessage = async ({ data: { file } }) => {
  try {
    const output = await optimizePdf(file, (progress) => self.postMessage({ progress }), (stage) => self.postMessage({ stage }));
    const bytes = output ? output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) : null;
    self.postMessage({ bytes }, bytes ? [bytes] : []);
  } catch {
    self.postMessage({ bytes: null });
  }
};
