import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateBody, validateParams, validatePathToken } from './validation.js';
import { ConsultSchema, StudentTokenSchema } from './schemas.js';

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

describe('validateBody', () => {
  it('정상 입력에 ok:true + data 반환', () => {
    const result = validateBody(ConsultSchema, { name: '김', phone: '01012345678' }, corsHeaders);
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('김');
  });

  it('잘못된 입력에 400 Response 반환', async () => {
    const result = validateBody(ConsultSchema, { name: '', phone: '123' }, corsHeaders);
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.error).toContain('입력 형식');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('400 응답에 corsHeaders 포함', () => {
    const result = validateBody(ConsultSchema, {}, corsHeaders);
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(result.response.headers.get('Content-Type')).toBe('application/json');
  });

  it('details 최대 5개로 제한 (응답 폭주 방지)', async () => {
    const ManySchema = z.object({
      a: z.string(), b: z.string(), c: z.string(), d: z.string(),
      e: z.string(), f: z.string(), g: z.string(),
    });
    const result = validateBody(ManySchema, {}, corsHeaders);
    expect(result.ok).toBe(false);
    const body = await result.response.json();
    expect(body.details.length).toBeLessThanOrEqual(5);
  });
});

describe('validatePathToken', () => {
  it('학생 토큰 정상 → ok:true', () => {
    const result = validatePathToken(StudentTokenSchema, 'ABCD1234EFGH', corsHeaders, '학생 토큰');
    expect(result.ok).toBe(true);
    expect(result.data).toBe('ABCD1234EFGH');
  });

  it('잘못된 토큰 → 400', async () => {
    const result = validatePathToken(StudentTokenSchema, 'invalid', corsHeaders, '학생 토큰');
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.error).toContain('학생 토큰');
  });
});

describe('validateParams', () => {
  it('정상 query 통과', () => {
    const Schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
    const result = validateParams(Schema, { month: '2026-04' }, corsHeaders);
    expect(result.ok).toBe(true);
  });

  it('잘못된 query → 400', async () => {
    const Schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
    const result = validateParams(Schema, { month: 'bad' }, corsHeaders);
    expect(result.ok).toBe(false);
    const body = await result.response.json();
    expect(body.error).toContain('파라미터');
  });
});
