import { describe, it, expect } from 'vitest';
import {
  StudentTokenSchema,
  NotionPageIdSchema,
  MonthSchema,
  ConsultSchema,
  HomeworkSubmitSchema,
  MyClassesQuerySchema,
} from './schemas.js';

describe('StudentTokenSchema', () => {
  it('12자 대문자+숫자 조합을 허용', () => {
    expect(StudentTokenSchema.safeParse('ABCD1234EFGH').success).toBe(true);
    expect(StudentTokenSchema.safeParse('ABCDEFGHIJKL').success).toBe(true);
    expect(StudentTokenSchema.safeParse('123456789012').success).toBe(true);
  });

  it('소문자/특수문자/길이 다른 값 거부', () => {
    expect(StudentTokenSchema.safeParse('abcd1234efgh').success).toBe(false);
    expect(StudentTokenSchema.safeParse('ABCD1234').success).toBe(false);
    expect(StudentTokenSchema.safeParse('ABCD1234EFGHI').success).toBe(false);
    expect(StudentTokenSchema.safeParse('ABCD-234EFGH').success).toBe(false);
    expect(StudentTokenSchema.safeParse('').success).toBe(false);
  });
});

describe('NotionPageIdSchema', () => {
  it('하이픈 있는 UUID 허용', () => {
    expect(NotionPageIdSchema.safeParse('314838fa-f2a6-8143-a6c7-e59c50f3bbdb').success).toBe(true);
  });

  it('하이픈 없는 32자 hex 허용', () => {
    expect(NotionPageIdSchema.safeParse('314838faf2a68143a6c7e59c50f3bbdb').success).toBe(true);
  });

  it('잘못된 형식 거부', () => {
    expect(NotionPageIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(NotionPageIdSchema.safeParse('').success).toBe(false);
    expect(NotionPageIdSchema.safeParse('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz').success).toBe(false);
  });
});

describe('MonthSchema', () => {
  it('YYYY-MM 형식 허용', () => {
    expect(MonthSchema.safeParse('2026-04').success).toBe(true);
    expect(MonthSchema.safeParse('2025-12').success).toBe(true);
  });

  it('잘못된 형식 거부', () => {
    expect(MonthSchema.safeParse('2026-4').success).toBe(false);
    expect(MonthSchema.safeParse('2026/04').success).toBe(false);
    expect(MonthSchema.safeParse('').success).toBe(false);
  });
});

describe('ConsultSchema', () => {
  it('필수 필드(name, phone)만 있어도 통과', () => {
    const result = ConsultSchema.safeParse({ name: '김학생', phone: '01012345678' });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('김학생');
  });

  it('전체 필드 채워져도 통과', () => {
    const result = ConsultSchema.safeParse({
      name: '이학생',
      phone: '010-1234-5678',
      kakaoId: 'lee_kakao',
      level: '조금 배운 적 있어요',
      preferredDays: ['월', '수'],
      preferredTime: '오전 (9-12시)',
      concerns: ['발음이 이상한 것 같아요'],
      reasons: ['업무&비즈니스'],
      message: '안녕하세요. 비즈니스 중국어 배우고 싶어요.',
    });
    expect(result.success).toBe(true);
  });

  it('전화번호 다양한 포맷 허용 (하이픈/공백)', () => {
    expect(ConsultSchema.safeParse({ name: '김', phone: '010-1234-5678' }).success).toBe(true);
    expect(ConsultSchema.safeParse({ name: '김', phone: '010 1234 5678' }).success).toBe(true);
    expect(ConsultSchema.safeParse({ name: '김', phone: '0212345678' }).success).toBe(true);
  });

  it('+82 국가코드 포함 시 12자리라 거부 (기존 동작 유지)', () => {
    // 원하면 schema에 +82 → 0 변환 추가 가능. 현재는 기존 worker 검증과 동일.
    expect(ConsultSchema.safeParse({ name: '김', phone: '+82-10-1234-5678' }).success).toBe(false);
  });

  it('이름 50자 초과 거부', () => {
    const longName = '가'.repeat(51);
    expect(ConsultSchema.safeParse({ name: longName, phone: '01012345678' }).success).toBe(false);
  });

  it('이름 빈 문자열 거부', () => {
    expect(ConsultSchema.safeParse({ name: '', phone: '01012345678' }).success).toBe(false);
    expect(ConsultSchema.safeParse({ name: '   ', phone: '01012345678' }).success).toBe(false);
  });

  it('전화번호 9자리 이하 거부', () => {
    expect(ConsultSchema.safeParse({ name: '김', phone: '123456789' }).success).toBe(false);
  });

  it('전화번호 12자리 이상 거부', () => {
    expect(ConsultSchema.safeParse({ name: '김', phone: '010123456789' }).success).toBe(false);
  });

  it('잘못된 level 값 거부', () => {
    expect(ConsultSchema.safeParse({ name: '김', phone: '01012345678', level: '고급' }).success).toBe(false);
  });

  it('잘못된 요일 값 거부', () => {
    expect(ConsultSchema.safeParse({ name: '김', phone: '01012345678', preferredDays: ['Mon'] }).success).toBe(false);
  });

  it('message 500자 초과 거부', () => {
    const longMsg = '안녕하세요. '.repeat(80);  // 480+자
    const result = ConsultSchema.safeParse({ name: '김', phone: '01012345678', message: longMsg + longMsg });
    expect(result.success).toBe(false);
  });

  it('알 수 없는 필드는 strip되어 통과', () => {
    const result = ConsultSchema.safeParse({
      name: '김',
      phone: '01012345678',
      hackField: '<script>alert(1)</script>',
    });
    expect(result.success).toBe(true);
    expect(result.data.hackField).toBeUndefined();
  });
});

describe('HomeworkSubmitSchema', () => {
  it('files 배열 정상', () => {
    const result = HomeworkSubmitSchema.safeParse({
      files: [{ fileUploadId: 'abc', fileName: 'hw.pdf' }],
    });
    expect(result.success).toBe(true);
  });

  it('빈 객체도 통과 (모두 optional)', () => {
    expect(HomeworkSubmitSchema.safeParse({}).success).toBe(true);
  });

  it('파일 21개 거부', () => {
    const files = Array(21).fill({ fileUploadId: 'a', fileName: 'b.pdf' });
    expect(HomeworkSubmitSchema.safeParse({ files }).success).toBe(false);
  });

  it('파일명 256자 거부', () => {
    const longName = 'a'.repeat(256);
    expect(HomeworkSubmitSchema.safeParse({
      files: [{ fileUploadId: 'a', fileName: longName }],
    }).success).toBe(false);
  });

  it('fileUploadId 빈 문자열 거부', () => {
    expect(HomeworkSubmitSchema.safeParse({
      files: [{ fileUploadId: '', fileName: 'b.pdf' }],
    }).success).toBe(false);
  });
});

describe('MyClassesQuerySchema', () => {
  it('month 있어도 통과', () => {
    expect(MyClassesQuerySchema.safeParse({ month: '2026-04' }).success).toBe(true);
  });

  it('month 없어도 통과 (optional)', () => {
    expect(MyClassesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('잘못된 month 형식 거부', () => {
    expect(MyClassesQuerySchema.safeParse({ month: '2026-4' }).success).toBe(false);
  });
});
