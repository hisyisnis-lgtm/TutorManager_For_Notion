import { queryPage, createPage, updatePage, deletePage, getPage } from './notionClient.js';

export const HOMEWORK_DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';

import { WORKER_URL } from '../config.js';
import { getToken } from './authUtils.js';

// ===== 파싱 =====

export function parseHomework(page) {
  const p = page.properties;
  const parseFiles = (files) =>
    (files ?? []).map((f) => ({ name: f.name, url: f.file?.url ?? f.external?.url ?? null }));
  const submitFiles = parseFiles(p['학생 제출 파일']?.files);
  const feedbackFiles = parseFiles(p['피드백 파일']?.files);
  return {
    id: page.id,
    title: p['제목']?.title?.[0]?.plain_text ?? '(제목 없음)',
    studentIds: p['학생']?.relation?.map((r) => r.id) ?? [],
    content: p['과제 내용']?.rich_text?.[0]?.plain_text ?? '',
    status: p['제출 상태']?.select?.name ?? '미제출',
    submitFiles,
    submitFile: submitFiles[0] ?? null, // 하위 호환
    submitDate: p['제출일']?.date?.start ?? null,
    feedbackText: p['피드백 텍스트']?.rich_text?.[0]?.plain_text ?? '',
    feedbackFiles,
    feedbackFile: feedbackFiles[0] ?? null, // 하위 호환
    feedbackDate: p['피드백일']?.date?.start ?? null,
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

export async function createHomework({ studentPageId, title, content }) {
  return createPage(HOMEWORK_DB, {
    제목: { title: [{ text: { content: title } }] },
    학생: { relation: [{ id: studentPageId }] },
    '과제 내용': { rich_text: [{ text: { content: content || '' } }] },
    '제출 상태': { select: { name: '미제출' } },
  });
}

export async function deleteHomework(id) {
  return deletePage(id);
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

/** 강사용: 최신 파일 URL 조회 (만료 시 재조회) */
export async function getHomeworkPage(id) {
  return getPage(id);
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

export function homeworkStatusColor(status) {
  if (status === '피드백완료') return { bg: '#f6ffed', text: '#389e0d' };
  if (status === '제출완료') return { bg: '#e6f4ff', text: '#0958d9' };
  return { bg: '#fff2f0', text: '#cf1322' };
}
