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
  // 선택 필드는 nullish() — 클라이언트가 빈값을 null로 보내는 패턴(LandingPage.jsx)을 그대로 수용.
  kakaoId: z.string().max(50).nullish(),
  level: z.enum(VALID_LEVELS, { errorMap: () => ({ message: '잘못된 수준 값입니다' }) }).nullish(),
  preferredDays: z.array(z.enum(VALID_DAYS, { errorMap: () => ({ message: '잘못된 요일 값입니다' }) })).nullish(),
  preferredTime: z.enum(VALID_TIMES, { errorMap: () => ({ message: '잘못된 시간대 값입니다' }) }).nullish(),
  concerns: z.array(z.enum(VALID_CONCERNS, { errorMap: () => ({ message: '잘못된 고민 값입니다' }) })).nullish(),
  reasons: z.array(z.enum(VALID_REASONS, { errorMap: () => ({ message: '잘못된 이유 값입니다' }) })).nullish(),
  reasonOther: z.string().max(200).nullish(),
  message: z.string().max(500, '상담 내용은 500자 이내로 입력해주세요').nullish(),
}).strip(); // 알 수 없는 필드는 조용히 제거

// ===== 학생앱 휴대폰 인증(step-up) — /personal/auth/* =====

/**
 * POST /personal/auth/request-otp · /personal/auth/teacher-grant body.
 * token = 학생 예약 코드. (서버가 이 코드로 학생·전화번호를 조회해 OTP 발송)
 */
export const StudentAuthRequestSchema = z.object({
  token: StudentTokenSchema,
}).strip();

/**
 * POST /personal/auth/verify-otp body.
 * code = 6자리 인증번호 (휴대폰 OTP 또는 강사 우회코드).
 */
export const StudentAuthVerifySchema = z.object({
  token: StudentTokenSchema,
  code: z.string().regex(/^\d{6}$/, '인증번호는 6자리 숫자입니다'),
}).strip();

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

// ===== /game/best/:token/:gameKey (미니게임 베스트) =====

/**
 * 게임 종류 키 — 새 게임/난이도 추가 시 enum 옵션만 늘림.
 * Notion DB의 '게임' select 옵션과 1:1 대응.
 * 'tone'은 레거시(난이도 도입 전), 'tone-easy/normal/hard'는 난이도별.
 */
export const GameKeySchema = z.enum(['tone', 'tone-easy', 'tone-normal', 'tone-hard'], {
  errorMap: () => ({ message: '알 수 없는 게임 키입니다' }),
});

/**
 * 성조 게임 난이도 — GET /game/tone-words/:difficulty
 * Notion DB '난이도' select 옵션과 매핑.
 */
export const ToneDifficultySchema = z.enum(['easy', 'normal', 'hard'], {
  errorMap: () => ({ message: '알 수 없는 난이도입니다 (easy/normal/hard)' }),
});

/**
 * POST /game/best/:token/:gameKey body — 게임 결과 1회분.
 * meta는 게임별 고유 데이터 (Notion '메타' 필드에 JSON 직렬화).
 */
export const GameResultSchema = z.object({
  score: z.number().int().min(0).max(99999),
  maxCombo: z.number().int().min(0).max(99),
  avgMs: z.number().min(0).max(60000),
  // meta는 자유 형식이지만 Notion '메타' rich_text(2000자 한도)에 저장되므로 직렬화 크기를 제한.
  // 정상 클라이언트는 난이도별 subset(w/eb)이라 1800자 이내. 초과 페이로드는 입력단에서 거부.
  meta: z.record(z.any()).optional()
    .refine((m) => m == null || JSON.stringify(m).length <= 1800, { message: 'meta가 너무 큽니다' }),
}).strip();
