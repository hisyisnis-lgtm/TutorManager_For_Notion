import { describe, it, expect } from 'vitest';
import { isSafeExternalUrl, maskPhone, maskToken } from './security.js';

describe('isSafeExternalUrl', () => {
  it('일반 https URL을 허용한다', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('https://api.notion.com/v1/databases')).toBe(true);
    expect(isSafeExternalUrl('https://www.google.com/search?q=test')).toBe(true);
  });

  it('http도 허용한다 (1차 방어선이라 https 강제 안 함)', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
  });

  it('잘못된 URL은 거부한다', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
  });

  it('http(s) 외 프로토콜은 거부한다', () => {
    expect(isSafeExternalUrl('ftp://example.com')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/plain;base64,SGVsbG8=')).toBe(false);
  });

  it('localhost·loopback을 차단한다 (SSRF 방어)', () => {
    expect(isSafeExternalUrl('http://localhost')).toBe(false);
    expect(isSafeExternalUrl('http://localhost:8080')).toBe(false);
    expect(isSafeExternalUrl('http://127.0.0.1')).toBe(false);
    expect(isSafeExternalUrl('http://127.1.2.3')).toBe(false);
  });

  it('사설망 IP를 차단한다 (RFC1918)', () => {
    expect(isSafeExternalUrl('http://10.0.0.1')).toBe(false);
    expect(isSafeExternalUrl('http://192.168.1.1')).toBe(false);
    expect(isSafeExternalUrl('http://172.16.0.1')).toBe(false);
    expect(isSafeExternalUrl('http://172.31.255.255')).toBe(false);
  });

  it('AWS/GCP 메타데이터 endpoint를 차단한다 (link-local)', () => {
    expect(isSafeExternalUrl('http://169.254.169.254/latest/meta-data/'))
      .toBe(false);
  });

  it('CGNAT 대역(100.64~127)을 차단한다', () => {
    expect(isSafeExternalUrl('http://100.64.0.1')).toBe(false);
    expect(isSafeExternalUrl('http://100.127.255.255')).toBe(false);
  });

  it('IP 직접 표기는 모두 거부 (IPv4)', () => {
    // 일반 콘텐츠 미리보기에 필요 없음
    expect(isSafeExternalUrl('http://8.8.8.8')).toBe(false);
    expect(isSafeExternalUrl('http://1.1.1.1')).toBe(false);
  });

  it('IPv6 리터럴/ULA/loopback 차단', () => {
    expect(isSafeExternalUrl('http://[::1]')).toBe(false);
    expect(isSafeExternalUrl('http://[fe80::1]')).toBe(false);
    expect(isSafeExternalUrl('http://[fc00::1]')).toBe(false);
  });

  it('.local·.internal 도메인 차단', () => {
    expect(isSafeExternalUrl('http://server.local')).toBe(false);
    expect(isSafeExternalUrl('http://api.internal')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('11자리 휴대폰을 끝 4자만 노출한다', () => {
    expect(maskPhone('01012345678')).toBe('***-****-5678');
    expect(maskPhone('010-1234-5678')).toBe('***-****-5678');
    expect(maskPhone('010 1234 5678')).toBe('***-****-5678');
  });

  it('10자리 번호도 처리한다 (구형 휴대폰 또는 지역번호)', () => {
    expect(maskPhone('0212345678')).toBe('***-****-5678');
  });

  it('숫자가 아닌 문자는 모두 제거 후 처리한다', () => {
    expect(maskPhone('+82-10-1234-5678')).toBe('***-****-5678');
    expect(maskPhone('010.1234.5678')).toBe('***-****-5678');
  });

  it('4자리 미만은 안전하게 *** 반환', () => {
    expect(maskPhone('123')).toBe('***');
    expect(maskPhone('12')).toBe('***');
    expect(maskPhone('')).toBe('***');
    expect(maskPhone(null)).toBe('***');
    expect(maskPhone(undefined)).toBe('***');
  });

  it('정확히 4자리는 끝 4자 노출', () => {
    expect(maskPhone('5678')).toBe('***-****-5678');
  });
});

describe('maskToken', () => {
  it('일반 토큰을 양 끝 4자만 노출한다', () => {
    expect(maskToken('ABCD1234EFGH5678')).toBe('ABCD...5678');
    expect(maskToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'))
      .toBe('eyJh...VCJ9');
  });

  it('학생 예약 코드 (12자)를 마스킹한다', () => {
    expect(maskToken('ABCD1234EFGH')).toBe('ABCD...EFGH');
  });

  it('8자 이하는 전체 마스킹 (안전상)', () => {
    expect(maskToken('12345678')).toBe('***');
    expect(maskToken('1234')).toBe('***');
    expect(maskToken('A')).toBe('***');
    expect(maskToken('')).toBe('***');
    expect(maskToken(null)).toBe('***');
    expect(maskToken(undefined)).toBe('***');
  });

  it('정확히 9자는 끝 4자만 노출 (경계 테스트)', () => {
    expect(maskToken('123456789')).toBe('1234...6789');
  });
});
