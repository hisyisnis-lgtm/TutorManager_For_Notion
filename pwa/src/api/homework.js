import {
  queryPage,
  createPage,
  updatePage } from './notionClient.js';
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
import { studentBearer,
  handleStudentAuthExpiry } from './studentAuth.js';
import { fetchWithTimeout,
  UPLOAD_TIMEOUT_MS } from './fetchTimeout.js';
import {
  STATUS_SUCCESS_BG,
  STATUS_SUCCESS_DARK,
  STATUS_INFO_DARK,
  STATUS_ERROR_BG,
  STATUS_ERROR_TEXT,
  STATUS_INFO_BG } from '../constants/theme.js';

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
export async function createHomework({ studentPageId, title, content, files, classId }) {
  const properties = {
    제목: { title: [{ text: { content: title } }] },
    학생: { relation: [{ id: studentPageId }] },
    '과제 내용': { rich_text: [{ text: { content: content || '' } }] },
    '제출 상태': { select: { name: '미제출' } },
  };
  // 어느 수업의 숙제인지(마무리 카드에서 낼 때). 수업 DB '숙제' relation으로 완료 판정에 쓴다(2026-09-04).
  if (classId) properties['수업'] = { relation: [{ id: classId }] };
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

/**
 * 강사용 파일 업로드 (JWT) → Worker가 Notion file_upload 생성 후 업로드
 *
 * ⚠️ 파일 이름을 바꾸려고 `new File([file], 이름)`으로 재포장하지 말 것.
 * 안드로이드에서 파일 선택기로 고른 파일은 실제 파일이 아니라 시스템이 중계하는 스트림이라,
 * 재포장하면 내용이 끝까지 복사되지 않고 뒤가 잘린다(2026-08 강사 녹음 파일 손상 사고 —
 * 3,126,011B 원본이 3,103,700B로 도착, iOS·curl은 멀쩡했고 안드로이드에서만 재현).
 * FormData.append의 세 번째 인자로 이름만 지정하면 원본을 그대로 보낼 수 있다.
 */
export async function uploadTeacherFile(file, fileName) {
  const form = new FormData();
  form.append('file', file, fileName || file.name);
  // 전송 중 잘림 탐지용 — 서버가 실제 수신 크기와 대조한다(worker/lib/upload.js).
  form.append('size', String(file.size));
  const res = await fetchWithTimeout(`${WORKER_URL}/homework/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  }, UPLOAD_TIMEOUT_MS);
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
 * - filesOnly: true면 파일 속성만 수정 — 텍스트·제출 상태·피드백일은 건드리지 않음.
 *   (파일 삭제 경로용: 이게 없으면 삭제만 해도 입력 중이던 미저장 텍스트가 커밋되고
 *    피드백일이 리셋되며, 미제출 숙제도 '피드백완료'로 바뀌는 부작용이 있었음)
 */
export async function saveFeedback(id, { feedbackText, files, existingFiles, filesOnly = false }) {
  const nowIso = new Date().toISOString();
  const properties = filesOnly ? {} : {
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

// 단일 요청이 이보다 오래 매달리면 중단 — 무한 스피너 방지(강사앱 notionClient와 동일 정책).
const STUDENT_REQUEST_TIMEOUT_MS = 25000;

async function studentFetch(method, path, body, studentToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (studentToken) {
    const bearer = studentBearer(studentToken);
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STUDENT_REQUEST_TIMEOUT_MS);
  const opts = { method, headers, cache: 'no-store', signal: controller.signal };
  if (body) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(`${WORKER_URL}${path}`, opts);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('요청 시간이 초과됐어요. 네트워크를 확인하고 잠시 후 다시 시도해주세요.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 학생 세션 만료 → 세션 정리 후 리로드(인증 게이트 재진입)
    if (res.status === 401) handleStudentAuthExpiry(studentToken);
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status; // 재시도 판단용 — 4xx는 다시 보내도 같은 결과
    throw err;
  }
  return data;
}

// 학생 파일 업로드·다운로드(FormData/blob)에 붙일 Authorization 헤더.
function studentAuthHeader(studentToken) {
  const bearer = studentBearer(studentToken);
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

/** 학생 숙제 목록 조회 */
export async function fetchMyHomework(studentToken) {
  return studentFetch('GET', `/homework/student/${encodeURIComponent(studentToken)}`, undefined, studentToken);
}

/**
 * 업로드 진행률이 필요할 때 쓰는 XHR 경로.
 *
 * fetch에는 업로드 진행 이벤트가 없다 — 큰 녹음 하나를 올리는 동안 화면이 "몇 번째 파일"에서
 * 멈춰 있으면 학생은 앱이 멈춘 줄 알고 나가버린다(2026-08-01 사고의 이탈 경로).
 * XHR의 upload.onprogress로 실제 전송량을 받아 퍼센트를 보여준다.
 *
 * 에러 규약은 fetch 경로와 동일 — HTTP 실패는 `err.status`를 싣고,
 * 네트워크·타임아웃은 status 없이 던져서 retryTransient가 재시도 대상으로 인식한다.
 */
function uploadViaXhr(url, formData, headers, { onProgress, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* 본문이 JSON이 아닐 수 있음 */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      const err = new Error(data.error || `파일 업로드 실패 (${xhr.status})`);
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error('네트워크가 끊겨 업로드하지 못했어요. 연결을 확인해주세요.'));
    xhr.ontimeout = () => reject(new Error('요청 시간이 초과됐어요. 네트워크를 확인하고 잠시 후 다시 시도해주세요.'));
    xhr.send(formData);
  });
}

/**
 * 학생용 파일 업로드 → Worker가 Notion file_upload 처리
 * @param {(loaded: number, total: number) => void} [opts.onProgress] 주면 XHR로 전송해 진행률을 보고한다.
 * @param {string} [opts.fileName] 저장할 이름. 재포장 대신 이 인자를 쓸 것 — 이유는 uploadTeacherFile 주석 참고.
 */
export async function uploadStudentFile(studentToken, file, { onProgress, fileName } = {}) {
  const form = new FormData();
  form.append('file', file, fileName || file.name);
  // 전송 중 잘림 탐지용 — 서버가 실제 수신 크기와 대조한다(worker/lib/upload.js).
  form.append('size', String(file.size));
  const url = `${WORKER_URL}/homework/student-upload/${encodeURIComponent(studentToken)}`;
  const headers = studentAuthHeader(studentToken);

  if (typeof onProgress === 'function' && typeof XMLHttpRequest !== 'undefined') {
    return uploadViaXhr(url, form, headers, { onProgress, timeoutMs: UPLOAD_TIMEOUT_MS });
  }

  const res = await fetchWithTimeout(
    url,
    { method: 'POST', body: form, cache: 'no-store', headers },
    UPLOAD_TIMEOUT_MS
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || '파일 업로드 실패');
    err.status = res.status;
    throw err;
  }
  return res.json(); // { fileUploadId, fileName }
}

/** 학생 숙제 제출 — files: [{fileUploadId, fileName}], deleteFileNames: [string] */
export async function submitHomework(studentToken, homeworkId, files, deleteFileNames = []) {
  return studentFetch('POST', `/homework/student/${encodeURIComponent(studentToken)}/${homeworkId}/submit`, {
    files,
    deleteFileNames,
  }, studentToken);
}

/**
 * 학생이 피드백완료 숙제를 처음 열어본 시점 기록.
 * Worker가 비어있을 때만 PATCH하므로 두 번째 호출부터는 idempotent — 먹이 중복 지급 방지.
 */
export async function markFeedbackSeen(studentToken, homeworkId) {
  return studentFetch('POST', `/homework/feedback-seen/${encodeURIComponent(studentToken)}`, {
    homeworkId,
  }, studentToken);
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
  // 파일 다운로드/미리보기 — 대용량 가능성이 있어 업로드와 같은 긴 타임아웃
  const res = await fetchWithTimeout(url, { cache: 'no-store', ...init }, UPLOAD_TIMEOUT_MS);
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
  const res = await fetchOrThrow(url, { headers: studentAuthHeader(studentToken) });
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
  const res = await fetchOrThrow(url, { headers: studentAuthHeader(studentToken) });
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
  if (status === '제출완료') return { bg: STATUS_INFO_BG, text: STATUS_INFO_DARK };
  return { bg: STATUS_ERROR_BG, text: STATUS_ERROR_TEXT };
}
