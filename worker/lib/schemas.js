// Worker 라우트 입력 검증 스키마 (zod)
// 새 공개 라우트 추가 시 여기에 schema 정의 후 validation.js 헬퍼로 검증.

import { z } from 'zod';

// ===== 공통 =====

/**
 * 학생 예약 코드 — 12자 대문자+숫자 (crypto.getRandomValues로 생성).
 * 알파벳 일부(I, L, O 등 헷갈리는 글자) 제외하지만 검증 단계에선 [A-Z0-9]로 단순화.
 */
export const StudentTokenSchema = z.string()
  .regex(/^[A-Z0-9]{12}$/, '형식이 올바르지 않습니다 (12자 대문자+숫자)');

/**
 * Notion 페이지 ID — UUID 형식 (하이픈 있음/없음 모두 허용).
 */
export const NotionPageIdSchema = z.string()
  .regex(/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i, '형식이 올바르지 않습니다');

/**
 * YYYY-MM 월 형식 (예: "2026-04").
 */
export const MonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM 형식이어야 합니다');

// ===== /consult (무료상담 신청) =====

const VALID_LEVELS = ['완전 처음이에요', '조금 배운 적 있어요', '어느 정도 배웠는데 막혀있어요'];
const VALID_DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const VALID_TIMES = ['오전 (9-12시)', '오후 (12-18시)', '저녁 (18-21시)'];
const VALID_CONCERNS = ['발음이 이상한 것 같아요', '배웠는데 막상 말이 안 나와요', '방향을 못 잡겠어요'];
const VALID_REASONS = ['여행', '드라마&콘텐츠', '업무&비즈니스', '중국인 지인&가족', '그냥 관심이 생겨서', '기타 (직접 입력)'];

export const ConsultSchema = z.object({
  name: z.string().trim().min(1, '이름은 필수입니다').max(50, '이름은 50자 이내로 입력해주세요'),
  phone: z.string().trim().refine(
    (p) => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 11;
    },
    { message: '전화번호 형식이 올바르지 않습니다 (10~11자리 숫자)' }
  ),
  kakaoId: z.string().max(50).optional(),
  level: z.enum(VALID_LEVELS, { errorMap: () => ({ message: '잘못된 수준 값입니다' }) }).optional(),
  preferredDays: z.array(z.enum(VALID_DAYS, { errorMap: () => ({ message: '잘못된 요일 값입니다' }) })).optional(),
  preferredTime: z.enum(VALID_TIMES, { errorMap: () => ({ message: '잘못된 시간대 값입니다' }) }).optional(),
  concerns: z.array(z.enum(VALID_CONCERNS, { errorMap: () => ({ message: '잘못된 고민 값입니다' }) })).optional(),
  reasons: z.array(z.enum(VALID_REASONS, { errorMap: () => ({ message: '잘못된 이유 값입니다' }) })).optional(),
  reasonOther: z.string().max(200).optional(),
  message: z.string().max(500, '상담 내용은 500자 이내로 입력해주세요').optional(),
}).strip(); // 알 수 없는 필드는 조용히 제거

// ===== /homework/student/:token/:id/submit (학생 숙제 제출) =====

export const HomeworkSubmitSchema = z.object({
  files: z.array(z.object({
    fileUploadId: z.string().min(1, 'fileUploadId는 필수입니다'),
    fileName: z.string().min(1).max(255, '파일명은 255자 이내'),
  })).max(20, '한 번에 20개 이하 파일만 제출 가능').optional(),
  deleteFileNames: z.array(z.string().max(255)).max(50).optional(),
}).strip();

// ===== Query/Path 파라미터 =====

/**
 * /booking/my-classes/:token?month=YYYY-MM
 * month는 선택 (없으면 전체 조회).
 */
export const MyClassesQuerySchema = z.object({
  month: MonthSchema.optional(),
}).strip();
