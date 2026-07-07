import { describe, it, expect } from 'vitest';
import {
  isSocialProvider,
  buildAuthorizeUrl,
  callbackUrl,
  decodeJwtPayload,
  extractGoogleIdentity,
  extractKakaoIdentity,
  socialUserKey,
  isAllowedRedirect,
  redirectPrefixes,
  appendTokenFragment,
  DEFAULT_REDIRECT_PREFIXES,
  signAuthState,
  verifyAuthState,
} from './oauth.js';

describe('isSocialProvider', () => {
  it('google·kakao만 허용', () => {
    expect(isSocialProvider('google')).toBe(true);
    expect(isSocialProvider('kakao')).toBe(true);
    expect(isSocialProvider('naver')).toBe(false);
    expect(isSocialProvider('')).toBe(false);
    expect(isSocialProvider(undefined)).toBe(false);
  });
});

describe('buildAuthorizeUrl', () => {
  it('google: scope 포함', () => {
    const u = new URL(buildAuthorizeUrl({ provider: 'google', clientId: 'CID', redirectUri: 'https://w.dev/game/auth/google/callback', state: 'st1' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('redirect_uri')).toBe('https://w.dev/game/auth/google/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('st1');
    expect(u.searchParams.get('scope')).toBe('openid profile');
  });
  it('kakao: scope 없음', () => {
    const u = new URL(buildAuthorizeUrl({ provider: 'kakao', clientId: 'K', redirectUri: 'https://w.dev/game/auth/kakao/callback', state: 's' }));
    expect(u.origin + u.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(u.searchParams.has('scope')).toBe(false);
  });
  it('알 수 없는 제공자는 throw', () => {
    expect(() => buildAuthorizeUrl({ provider: 'x', clientId: 'a', redirectUri: 'b', state: 'c' })).toThrow();
  });
});

describe('callbackUrl', () => {
  it('origin + 고정 경로', () => {
    expect(callbackUrl('https://w.dev', 'google')).toBe('https://w.dev/game/auth/google/callback');
    expect(callbackUrl('https://w.dev', 'kakao')).toBe('https://w.dev/game/auth/kakao/callback');
  });
});

describe('decodeJwtPayload', () => {
  it('유효 JWT payload 디코드 — UTF-8 한글 이름 round-trip', () => {
    const payload = { sub: '123', name: '홍길동', exp: 9999999999 };
    // 실제 JWT처럼 UTF-8 바이트 → base64url 인코딩(한글 포함).
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const b64 = btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const jwt = `hdr.${b64}.sig`;
    expect(decodeJwtPayload(jwt)).toEqual(payload);
  });
  it('잘못된 입력은 null', () => {
    expect(decodeJwtPayload('')).toBe(null);
    expect(decodeJwtPayload('onlyonepart')).toBe(null);
    expect(decodeJwtPayload('a.@@@.c')).toBe(null);
    expect(decodeJwtPayload(null)).toBe(null);
  });
});

describe('extractGoogleIdentity', () => {
  it('sub·name 추출', () => {
    expect(extractGoogleIdentity({ sub: '42', name: 'Kim' })).toEqual({ socialId: '42', nickname: 'Kim' });
  });
  it('name 없으면 given_name, 그것도 없으면 null', () => {
    expect(extractGoogleIdentity({ sub: '7', given_name: 'Gil' })).toEqual({ socialId: '7', nickname: 'Gil' });
    expect(extractGoogleIdentity({ sub: '7' })).toEqual({ socialId: '7', nickname: null });
  });
  it('sub 없으면 null', () => {
    expect(extractGoogleIdentity({ name: 'x' })).toBe(null);
    expect(extractGoogleIdentity(null)).toBe(null);
  });
});

describe('extractKakaoIdentity', () => {
  it('id는 문자열화, 닉네임은 kakao_account 우선', () => {
    expect(extractKakaoIdentity({ id: 555, kakao_account: { profile: { nickname: '카톡닉' } } }))
      .toEqual({ socialId: '555', nickname: '카톡닉' });
  });
  it('properties.nickname 폴백', () => {
    expect(extractKakaoIdentity({ id: 1, properties: { nickname: '구닉' } }))
      .toEqual({ socialId: '1', nickname: '구닉' });
  });
  it('id 없으면 null, 닉네임 없으면 null 유지', () => {
    expect(extractKakaoIdentity({})).toBe(null);
    expect(extractKakaoIdentity({ id: 9 })).toEqual({ socialId: '9', nickname: null });
  });
});

describe('socialUserKey', () => {
  it('제공자 네임스페이스 결합', () => {
    expect(socialUserKey('kakao', '555')).toBe('kakao:555');
    expect(socialUserKey('google', '42')).toBe('google:42');
  });
});

describe('isAllowedRedirect', () => {
  const prefixes = DEFAULT_REDIRECT_PREFIXES;
  it('허용 prefix로 시작하면 true', () => {
    expect(isAllowedRedirect('https://tiantian-chinese.pages.dev/game/tone', prefixes)).toBe(true);
    expect(isAllowedRedirect('capacitor://localhost/x', prefixes)).toBe(true);
    expect(isAllowedRedirect('http://localhost:5173/game/tone', prefixes)).toBe(true);
  });
  it('허용 목록 밖·빈값은 false(오픈 리다이렉트 차단)', () => {
    expect(isAllowedRedirect('https://evil.example.com', prefixes)).toBe(false);
    expect(isAllowedRedirect('', prefixes)).toBe(false);
    expect(isAllowedRedirect(null, prefixes)).toBe(false);
    // prefix가 부분일치라도 시작이 아니면 차단
    expect(isAllowedRedirect('https://evil.com/https://localhost', prefixes)).toBe(false);
  });
});

describe('redirectPrefixes', () => {
  it('기본값 + env 확장 병합', () => {
    const out = redirectPrefixes({ GAME_AUTH_REDIRECTS: 'tiantiantone://, https://staging.example.com' });
    expect(out).toContain('https://tiantian-chinese.pages.dev');
    expect(out).toContain('tiantiantone://');
    expect(out).toContain('https://staging.example.com');
  });
  it('env 없으면 기본값만', () => {
    expect(redirectPrefixes({})).toEqual(DEFAULT_REDIRECT_PREFIXES);
    expect(redirectPrefixes(undefined)).toEqual(DEFAULT_REDIRECT_PREFIXES);
  });
});

describe('appendTokenFragment', () => {
  it('# 없으면 #token=, 있으면 &token=', () => {
    expect(appendTokenFragment('https://w.dev/game', 'ABC')).toBe('https://w.dev/game#token=ABC');
    expect(appendTokenFragment('https://w.dev/game#x=1', 'A B')).toBe('https://w.dev/game#x=1&token=A%20B');
  });
});

describe('signAuthState / verifyAuthState — 무상태 서명 state', () => {
  const SECRET = 'test-secret-key';
  it('round-trip: 서명한 state를 검증하면 provider·redirect 복원', async () => {
    const state = await signAuthState(SECRET, { provider: 'kakao', redirect: 'http://localhost:5178/game/tone' });
    const out = await verifyAuthState(SECRET, state);
    expect(out).toEqual({ provider: 'kakao', redirect: 'http://localhost:5178/game/tone' });
  });
  it('state는 URL-safe(base64url) — +/= 없음', async () => {
    const state = await signAuthState(SECRET, { provider: 'google', redirect: 'https://tiantian-chinese.pages.dev/game/tone' });
    expect(state).not.toMatch(/[+/=]/);
    expect(state.split('.')).toHaveLength(2);
  });
  it('다른 시크릿·변조된 state는 null(위조 차단)', async () => {
    const state = await signAuthState(SECRET, { provider: 'kakao', redirect: 'http://localhost/game' });
    expect(await verifyAuthState('wrong-secret', state)).toBe(null);
    const [body] = state.split('.');
    expect(await verifyAuthState(SECRET, `${body}.AAAA`)).toBe(null);   // 서명 변조
    // payload 변조(서명 불일치)
    const forged = `${btoa(JSON.stringify({ p: 'kakao', r: 'https://evil.com', exp: 9999999999 })).replace(/=+$/, '')}.${state.split('.')[1]}`;
    expect(await verifyAuthState(SECRET, forged)).toBe(null);
  });
  it('만료된 state는 null (ttl 음수)', async () => {
    const state = await signAuthState(SECRET, { provider: 'kakao', redirect: 'http://localhost/game' }, -1);
    expect(await verifyAuthState(SECRET, state)).toBe(null);
  });
  it('형식 오류·빈 시크릿은 null', async () => {
    expect(await verifyAuthState(SECRET, '')).toBe(null);
    expect(await verifyAuthState(SECRET, 'onlyonepart')).toBe(null);
    expect(await verifyAuthState('', 'a.b')).toBe(null);
  });
});
