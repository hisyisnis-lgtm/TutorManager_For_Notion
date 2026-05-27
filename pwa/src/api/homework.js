import { queryPage, createPage, updatePage } from './notionClient.js';
import {
  getTitle,
  getRichText,
  getSelect,
  getDate,
  getRelationIds,
} from '../utils/notionProp.js';

export const HOMEWORK_DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';

import { WORKER_URL } from '../config.js';
import { getToken } from './authUtils.js';
import {
  STATUS_SUCCESS_BG,
  STATUS_SUCCESS_DARK,
  STATUS_INFO_DARK,
  STATUS_ERROR_BG,
  STATUS_ERROR_TEXT,
} from '../constants/theme.js';

// ===== 파싱 =====

export function parseHomework(page) {
  const p = page.properties;
  const parseFiles = (files) =>
    (files ?? []).map((f) => ({ name: f.name, url: f.file?.url ?? f.external?.url ?? null }));
  const submitFiles = parseFiles(p['학생 제출 파일']?.files);
  const feedbackFiles = parseFiles(p['피드백 파일']?.files);
  const assignmentFiles = parseFiles(p['과제 파일']?.files);
  return {
    id: page.id,
    title: getTitle(p['제목'], '(제목 없음)'),
    studentIds: getRelationIds(p['학생']),
    content: getRichText(p['과제 내용']),
    assignmentFiles,
    status: getSelect(p['제출 상태'], '미제출'),
    submitFiles,
    submitFile: submitFiles[0] ?? null, // 하위 호환
    submitDate: getDate(p['제출일']),
    feedbackText: getRichText(p['피드백 텍스트']),
    feedbackFiles,
    feedbackFile: feedbackFiles[0] ?? null, // 하위 호환
    feedbackDate: getDate(p['피드백일']),
    // 판다 먹이 시스템용 — 학생 첫 제출/피드백 첫 확인 시점 (Worker가 자동 기록)
    submitMark: getDate(p['제출 먹이 마크']),
    feedbackSeenDate: getDate(p['피드백 확인일']),
    createdTime: page.created_time,
  };
}

// ===== 강사용 (JWT 인증 — Notion 프록시) =====

export async function fetchStudentHomework(studentPageId) {
  return queryPage(
    HOMEWORK_DB,
    { property: '학생', relation: { contains: studentPageId } },
    [{ timestamp: 'created_time', direction: 'descending' }],
    undefined,
    100
  );
}

/**
 * 강사 숙제 등록
 * @param {object} args
 * @param {string} args.studentPageId
 * @param {string} args.title
 * @param {string} [args.content]
 * @param {Array<{fileUploadId: string, fileName: string}>} [args.files]  과제 파일(녹음·이미지·PDF 통합)
 */
export async function createHomework({ studentPageId, title, content, files }) {
  const properties = {
    제목: { title: [{ text: { content: title } }] },
    학생: { relation: [{ id: studentPageId }] },
    '과제 내용': { rich_text: [{ text: { content: content || '' } }] },
    '제출 상태': { select: { name: '미제출' } },
  };
  if (files && files.length > 0) {
    properties['과제 파일'] = {
      files: files.map(({ fileUploadId, fileName }) => ({
        name: fileName,
        type: 'file_upload',
        file_upload: { id: fileUploadId },
      })),
    };
  }
  return createPage(HOMEWORK_DB, properties);
}

/** 강사용 파일 업로드 (JWT) → Worker가 Notion file_upload 생성 후 업로드 */
export async function uploadTeacherFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${WORKER_URL}/homework/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '파일 업로드 실패');
  }
  return res.json(); // { fileUploadId, fileName }
}

/**
 * 강사 피드백 저장
 * - files: [{fileUploadId, fileName}]   새로 업로드할 파일 목록
 * - existingFiles: [{name, url}]        보존할 기존 파일 (fresh URL 필요)
 * - 둘 다 없으면 피드백 파일 속성을 건드리지 않음 (기존 유지)
 */
export async function saveFeedback(id, { feedbackText, files, existingFiles }) {
  const nowIso = new Date().toISOString();
  const properties = {
    '피드백 텍스트': { rich_text: [{ text: { content: feedbackText || '' } }] },
    '제출 상태': { select: { name: '피드백완료' } },
    피드백일: { date: { start: nowIso } },
  };

  // files 또는 existingFiles 중 하나라도 명시적으로 전달된 경우 속성 업데이트
  // (undefined이면 건드리지 않음 — 기존 파일 유지)
  if (files !== undefined || existingFiles !== undefined) {
    properties['피드백 파일'] = {
      files: [
        // 기존 파일: raw Notion 파일 객체 그대로 재첨부 (type: 'file' 보존)
        ...(existingFiles ?? []),
        // 새 파일: file_upload
        ...(files ?? []).map(({ fileUploadId, fileName }) => ({
          name: fileName,
          type: 'file_upload',
          file_upload: { id: fileUploadId },
        })),
      ],
    };
  }

  return updatePage(id, properties);
}

/**
 * 학생에게 카카오 알림톡 발송 요청 (fire-and-forget)
 * kind: 'assign' | 'feedback'
 * Worker 쪽에서 템플릿/Secret 미설정 시 no-op 처리되므로 실패해도 흐름 중단 안 함.
 */
export async function notifyHomework(kind, homeworkId) {
  try {
    const path = kind === 'feedback' ? '/homework/notify-feedback' : '/homework/notify-assign';
    await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ homeworkId }),
    });
  } catch (e) {
    console.warn('[notifyHomework] 실패:', e.message);
  }
}

// ===== 학생용 (Worker 공개 엔드포인트 — 예약 코드 인증) =====

async function studentFetch(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${WORKER_URL}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** 학생 숙제 목록 조회 */
export async function fetchMyHomework(studentToken) {
  return studentFetch('GET', `/homework/student/${encodeURIComponent(studentToken)}`);
}

/** 학생용 파일 업로드 → Worker가 Notion file_upload 처리 */
export async function uploadStudentFile(studentToken, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(
    `${WORKER_URL}/homework/student-upload/${encodeURIComponent(studentToken)}`,
    { method: 'POST', body: form, cache: 'no-store' }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '파일 업로드 실패');
  }
  return res.json(); // { fileUploadId, fileName }
}

/** 학생 숙제 제출 — files: [{fileUploadId, fileName}], deleteFileNames: [string] */
export async function submitHomework(studentToken, homeworkId, files, deleteFileNames = []) {
  return studentFetch('POST', `/homework/student/${encodeURIComponent(studentToken)}/${homeworkId}/submit`, {
    files,
    deleteFileNames,
  });
}

/**
 * 학생이 피드백완료 숙제를 처음 열어본 시점 기록.
 * Worker가 비어있을 때만 PATCH하므로 두 번째 호출부터는 idempotent — 먹이 중복 지급 방지.
 */
export async function markFeedbackSeen(studentToken, homeworkId) {
  return studentFetch('POST', `/homework/feedback-seen/${encodeURIComponent(studentToken)}`, {
    homeworkId,
  });
}

// ===== 파일 다운로드 (Worker proxy — Notion 임시 URL 미노출) =====

/**
 * 학생/강사 공용 — fetch 결과를 anchor click으로 브라우저 다운로드 트리거.
 * Content-Disposition: attachment는 Worker가 부여하므로 a.download 속성은 폴백.
 */
function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 revoke하면 일부 브라우저에서 다운로드가 중단됨 → 다음 틱에 정리.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function fetchOrThrow(url, init) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `요청 실패 (${res.status})`);
  }
  return res;
}

/**
 * 학생용 파일 다운로드 — 예약 코드로 본인 숙제 파일만 받을 수 있다.
 * @param {string} studentToken
 * @param {string} homeworkId
 * @param {string} fileName
 * @param {'submit'|'feedback'} kind
 */
export async function downloadHomeworkFileStudent(studentToken, homeworkId, fileName, kind) {
  const url = `${WORKER_URL}/homework/student/${encodeURIComponent(studentToken)}/${encodeURIComponent(homeworkId)}/file?name=${encodeURIComponent(fileName)}&kind=${kind}`;
  const res = await fetchOrThrow(url);
  const blob = await res.blob();
  triggerBlobDownload(blob, fileName);
}

/**
 * 강사용 파일 다운로드 (JWT 인증).
 */
export async function downloadHomeworkFileTeacher(homeworkId, fileName, kind) {
  const url = `${WORKER_URL}/homework/${encodeURIComponent(homeworkId)}/file?name=${encodeURIComponent(fileName)}&kind=${kind}`;
  const res = await fetchOrThrow(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  const blob = await res.blob();
  triggerBlobDownload(blob, fileName);
}

/**
 * 인라인 표시용 — 파일을 blob URL로 받는다.
 * 호출자는 사용 끝난 뒤 반드시 `URL.revokeObjectURL`로 해제해야 메모리 누수가 없다.
 * (FilePreview 같은 컴포넌트에서 useEffect cleanup에 묶어 호출)
 */
export async function fetchHomeworkFileBlobUrlStudent(studentToken, homeworkId, fileName, kind) {
  const url = `${WORKER_URL}/homework/student/${encodeURIComponent(studentToken)}/${encodeURIComponent(homeworkId)}/file?name=${encodeURIComponent(fileName)}&kind=${kind}`;
  const res = await fetchOrThrow(url);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function fetchHomeworkFileBlobUrlTeacher(homeworkId, fileName, kind) {
  const url = `${WORKER_URL}/homework/${encodeURIComponent(homeworkId)}/file?name=${encodeURIComponent(fileName)}&kind=${kind}`;
  const res = await fetchOrThrow(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function homeworkStatusColor(status) {
  if (status === '피드백완료') return { bg: STATUS_SUCCESS_BG, text: STATUS_SUCCESS_DARK };
  if (status === '제출완료') return { bg: '#e6f4ff', text: STATUS_INFO_DARK };
  return { bg: STATUS_ERROR_BG, text: STATUS_ERROR_TEXT };
}
