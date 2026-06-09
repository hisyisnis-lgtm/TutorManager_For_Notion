// 로그인(회원) — 휴대폰 + 카카오 알림톡 OTP. Figma "로그인"(182:2). 단일 통합화면(단계 상태).
// 이름=닉네임. verify 성공 시 게스트 로컬 → 회원 로컬 병합 후 서버 업로드.
import { useState, useEffect } from 'react';
import { App } from 'antd';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { requestGameOtp, verifyGameOtp } from '../../api/gameApi.js';
import { resolveIdentity, loginMember, mergeGuestIntoMember, pushMemberData } from '../gameStore.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble } from './shared.jsx';

export function LoginScreen({ onBack, onSuccess }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const { message } = App.useApp();

  useEffect(() => {
    if (timer <= 0) return undefined;
    const t = setTimeout(() => setTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = /^01[016789]\d{7,8}$/.test(phoneDigits);
  const codeValid = /^\d{6}$/.test(code);
  const fmtTimer = `${String(Math.floor(timer / 60)).padStart(2, '0')}:${String(timer % 60).padStart(2, '0')}`;

  const reqOtp = async () => {
    if (!phoneValid || loading) { if (!phoneValid) message.error('휴대폰 번호를 확인해주세요.'); return; }
    setLoading(true);
    try {
      const r = await requestGameOtp(phoneDigits);
      setOtpSent(true); setTimer(180); playSfx('button');
      message.success('인증번호를 보냈어요. 카카오톡을 확인해주세요.');
      if (r?.devCode) message.info(`개발 코드: ${r.devCode}`);
    } catch (e) { message.error(e?.message || '발송에 실패했어요.'); }
    finally { setLoading(false); }
  };

  const doLogin = async () => {
    if (!otpSent || !codeValid || loading) return;
    setLoading(true);
    try {
      const { token, user } = await verifyGameOtp(phoneDigits, code);
      const nick = name.trim() || user?.nickname || null;
      loginMember(token, { ...user, nickname: nick });
      const idn = resolveIdentity(undefined); // 회원 세션 반영
      mergeGuestIntoMember(idn);              // 게스트 로컬 → 회원 로컬 병합
      await pushMemberData(idn, nick).catch(() => {}); // 회원 로컬+이름 → 서버 업로드
      playSfx('win');
      onSuccess();
    } catch (e) { message.error(e?.message || '로그인에 실패했어요.'); }
    finally { setLoading(false); }
  };

  const ctaReady = otpSent && codeValid;
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>로그인</span>
        </div>
      </Reveal>
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 120 }}>
        <CoachBubble text="휴대폰 번호로 기록을 저장해드려요" />
      </Reveal>
      {/* 이름 입력 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 217 }}>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 12))} type="text" placeholder="이름"
          style={{ width: '100%', height: 62, borderRadius: 16, border: '1.5px solid #efeae4', background: '#fff', padding: '0 18px', fontSize: 16, fontFamily: FONT_BODY, color: '#2b2730', outline: 'none', boxSizing: 'border-box' }} />
      </Reveal>
      {/* 휴대폰 입력 + 인라인 '인증번호 받기' */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 291 }}>
        <div style={{ position: 'relative', height: 62 }}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="numeric" placeholder="휴대폰 번호"
            style={{ width: '100%', height: 62, borderRadius: 16, border: '1.5px solid #efeae4', background: '#fff', padding: '0 124px 0 18px', fontSize: 16, fontFamily: FONT_BODY, color: '#2b2730', outline: 'none', boxSizing: 'border-box' }} />
          <button onClick={reqOtp} disabled={!phoneValid || loading} className="tg-press" style={{ position: 'absolute', right: 10, top: 10, height: 42, padding: '0 14px', borderRadius: 12, border: 'none', cursor: phoneValid ? 'pointer' : 'default', background: phoneValid ? '#FFE8E8' : '#f3efe9', display: 'flex', alignItems: 'center', ...TOUCH_OPT }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: phoneValid ? TG.CORAL_DK : '#b8b0a8' }}>{otpSent && timer > 0 ? fmtTimer : '인증번호 받기'}</span>
          </button>
        </div>
      </Reveal>
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 361 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0' }}>카카오 알림톡으로 인증번호를 보내드려요</span>
      </Reveal>
      {/* 인증번호 입력 (받기 전 비활성) */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, top: 385 }}>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} type="tel" inputMode="numeric" maxLength={6} placeholder="인증번호 6자리" disabled={!otpSent}
          style={{ width: '100%', height: 62, borderRadius: 16, border: '1.5px solid #efeae4', background: otpSent ? '#fff' : '#f7f3ee', padding: '0 18px', fontSize: 16, fontFamily: FONT_BODY, color: '#2b2730', outline: 'none', boxSizing: 'border-box', letterSpacing: 3 }} />
      </Reveal>
      {otpSent && (
        <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, top: 455 }}>
          <button onClick={reqOtp} disabled={timer > 0 || loading} style={{ background: 'none', border: 'none', cursor: timer > 0 ? 'default' : 'pointer', padding: 0, ...TOUCH_OPT }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: timer > 0 ? '#c4bdb4' : TG.CORAL_DK }}>인증번호 다시 받기</span>
          </button>
        </Reveal>
      )}
      <Reveal i={7} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
        <button onClick={doLogin} disabled={!ctaReady || loading} className="tg-press" style={{
          width: '100%', height: 62, borderRadius: 20, border: 'none', cursor: ctaReady ? 'pointer' : 'default',
          background: ctaReady ? TG.CORAL_GRAD : '#e8e2da', boxShadow: ctaReady ? '0px 10px 20px rgba(242,72,76,0.32)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT,
        }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>{loading ? '잠시만요…' : '로그인'}</span>
        </button>
      </Reveal>
    </>
  );
}
