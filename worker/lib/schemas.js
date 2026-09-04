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
  })).max(5, '파일은 최대 5개까지 제출할 수 있어요').optional(),  // 서버 제출 룰(총 5개)과 동일
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
 * POST /game/event body — 게임 이벤트 카운터(유입 깔때기 측정, Workers Analytics Engine).
 * 익명 설계: PII 필드 자체가 없음(전화·토큰·이름 금지). 선택 필드는 .nullish()(클라가 빈값을 null로 보냄).
 */
export const GameEventSchema = z.object({
  e: z.enum(['enter', 'run_start', 'run_end', 'onboarding_done', 'cta_play_link', 'login_success'], {
    errorMap: () => ({ message: '알 수 없는 이벤트입니다' }),
  }),
  m: z.string().max(24).nullish(),   // 모드·채널 등 부가 라벨 (예: easy/endless/drama, insta/youtube)
  src: z.string().max(16).nullish(), // 유입 소스: web | standalone | twa | ios (스토어 출시 대비)
  k: z.string().max(10).nullish(),   // 신원 종류: guest | member | student
  v: z.number().finite().nullish(),  // 수치(선택, 예: run_end 점수)
}).strip();

/**
 * PUT /game/me 의 nickname(선택) — 소셜 로그인 직후 사용자가 직접 입력하는 자유 텍스트.
 * 제공자가 주던 값과 달리 신뢰할 수 없으므로 신뢰경계에서 검증한다(길이·제어문자).
 * 상한 12자는 클라이언트 NicknameScreen(NICKNAME_MAX)와 반드시 동일하게 유지.
 */
export const GameNicknameSchema = z.string()
  .trim()
  .min(1, '닉네임을 입력해주세요')
  .max(12, '닉네임은 12자 이내로 입력해주세요')
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), { message: '닉네임에 사용할 수 없는 문자가 있어요' });

/**
 * 공지 작성·수정 body (강사 전용, 전체 학생 공통 공지).
 * 선택 필드는 `.optional()`이 아니라 `.nullish()` — PWA가 빈 값을 null로 보낸다.
 * 본문 상한 2000자는 Notion rich_text 한 조각의 한계와 맞춘 값(그 이상은 잘려 저장된다).
 */
export const NoticeSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력해주세요').max(120, '제목은 120자 이내로 입력해주세요'),
  content: z.string().max(2000, '내용은 2000자 이내로 입력해주세요').nullish(),
  publishedAt: z.string().max(40).nullish(), // ISO 날짜 문자열. 비우면 서버가 오늘로 채운다
  visible: z.boolean().nullish(),            // 기본 true — 체크 해제하면 학생에게 안 보인다
  important: z.boolean().nullish(),          // 기본 false — 학생앱 목록 상단 고정
}).strip();
