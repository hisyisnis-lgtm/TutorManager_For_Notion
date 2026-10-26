import { MAX_FILE_BYTES, MAX_FILE_MB } from './audioFile.js';

export const MAX_FILES = 10;
export const MAX_TOTAL_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_FILE_MB = 50;

/** File·pending 항목·서버 파일 메타데이터의 크기를 한 방식으로 읽는다. */
export function homeworkFileSize(item) {
  const value = item?.file?.size ?? item?.size ?? item?.fileSize ?? item?.content_length;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function homeworkFileUsage(files = []) {
  return files.reduce((usage, item) => {
    const size = homeworkFileSize(item);
    usage.count += 1;
    if (size === null) usage.unknownCount += 1;
    else usage.bytes += size;
    return usage;
  }, { count: 0, bytes: 0, unknownCount: 0 });
}

export function validateHomeworkFiles(files = [], { maxFiles = MAX_FILES } = {}) {
  if (files.length > maxFiles) return { ok: false, error: `파일은 최대 ${maxFiles}개까지 첨부할 수 있어요` };
  if (files.some((item) => homeworkFileSize(item) > MAX_FILE_BYTES)) {
    return { ok: false, error: `파일 하나는 ${MAX_FILE_MB}MB까지만 첨부할 수 있어요` };
  }
  const usage = homeworkFileUsage(files);
  if (usage.unknownCount) return { ok: false, error: '기존 파일 용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  if (usage.bytes > MAX_TOTAL_FILE_BYTES) {
    return { ok: false, error: `기존 파일을 포함한 전체 용량은 ${MAX_TOTAL_FILE_MB}MB까지예요. 파일을 줄이거나 기존 파일을 삭제해 주세요.` };
  }
  return { ok: true, ...usage };
}

export function formatHomeworkBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
