// 프로필 모달 — 홈 상단 내 정보 카드(MyInfo) 탭 시 항상 먼저 뜬다(게스트·회원 공통).
// 로그인 상태 + 닉네임(+수정) + 등급(엠블럼·게이지)을 한 곳에서 보여주고,
// 게스트면 SNS 로그인 버튼을, 회원이면 로그아웃을 노출한다.
// 시각 패턴은 NicknameEditModal·HomeMenu와 통일(다크 오버레이 + 카드). SNS 버튼/로그인 시작은 LoginScreen 공용.
import { useState } from 'react';
import { Pen, CloseCircle, Copy, CheckCircle } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';
import { startSocialLogin, KakaoLogo, GoogleLogo } from './LoginScreen.jsx';
import { levelInfo } from '../gameXp.js';
import { ModalCard } from './shared.jsx';

export function ProfileModal({
  tier, nickname, isGuest, isMemberUser, userId,
  onEditNickname, onExam, onLogout, onClose,
}) {
  const displayName = nickname || '게스트';
  const lv = levelInfo(tier.xp || 0);           // 레벨 = 누적 XP 성장(Lv.N). 등급(tier.emblem/name)은 보스 클리어.
  const pct = Math.round(lv.progress * 100);
  const [copied, setCopied] = useState(false);
  const copyId = async () => {
    if (!userId) return;
    const text = String(userId);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('no clipboard api');
    } catch {
      // 웹뷰(Capacitor 등)에서 clipboard API가 없을 때 폴백 — 숨은 textarea + execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* 그래도 안 되면 표시만 */ }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <ModalCard onClose={onClose} maxWidth={320} radius={24} padding="20px 22px 22px" gap={16} align="stretch">
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...TYPE.head, fontSize: 18, color: TG.INK }}>내 프로필</span>
          {/* 히트영역 44×44(음수 마진으로 레이아웃 자리는 30 유지) */}
          <button onClick={onClose} aria-label="닫기" className="tg-press"
            style={{ width: 44, height: 44, margin: -7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <CloseCircle size={28} weight="Bold" color={TG.SUB} />
          </button>
        </div>

        {/* 프로필 — 엠블럼 76 + 닉네임(+수정) + 등급명·레벨 게이지(시안 461:108) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.x2 }}>
          <img src={tier.emblem} alt="" width={76} height={76} style={{ display: 'block', flexShrink: 0, objectFit: 'contain' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            {/* 닉네임 + 수정 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
              <span style={{ ...TYPE.h1, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
              {onEditNickname && (
                <button onClick={onEditNickname} aria-label="닉네임 수정" className="tg-press"
                  style={{ width: 30, height: 30, margin: -6, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
                  <Pen size={18} weight="Bold" color={TG.CORAL_DK} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
              {/* 한 줄 고정 — 최고 등급('성조 고수 · 최고 등급 · Lv.22' = 186px)이 정보 컬럼(184)을 넘겨 두 줄이 되던 것:
                  '최고 등급'을 '최고'로 줄이고(157px) 줄바꿈 금지. 그래도 넘치면 말줄임. */}
              <span style={{ ...TYPE.label, color: '#9A93A0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tier.name}{tier.isMax ? ' · 최고' : ''} · Lv.{lv.level}
              </span>
              {/* 레벨 게이지 — 시안: 높이 10 · 트랙 #EBE5DE(r37) · 채움 #F2484C(r14) */}
              <div style={{ width: '100%', height: 10, borderRadius: 37, background: '#EBE5DE', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 14, background: '#F2484C', transition: 'width .5s ease' }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: TG.BORDER }} />

        {/* 로그인 상태 */}
        {isGuest ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
            <span style={{ ...TYPE.label, color: '#9A93A0', textAlign: 'center' }}>로그인하면 기기를 바꿔도 기록이 그대로예요</span>
            <button onClick={() => startSocialLogin('kakao')} className="tg-press" style={{ width: '100%', height: 52, borderRadius: RADIUS.lg, border: 'none', background: '#FEE500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, cursor: 'pointer', ...TOUCH_OPT }}>
              <KakaoLogo />
              <span style={{ ...TYPE.btnSm, color: 'rgba(0,0,0,0.85)' }}>카카오로 시작하기</span>
            </button>
            <button onClick={() => startSocialLogin('google')} className="tg-press" style={{ width: '100%', height: 52, borderRadius: RADIUS.lg, border: '1px solid #747775', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.lg, cursor: 'pointer', ...TOUCH_OPT }}>
              <GoogleLogo />
              <span style={{ ...TYPE.btnSm, color: '#1f1f1f' }}>Google로 계속하기</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
            <span style={{ ...TYPE.label, color: '#9A93A0', textAlign: 'center' }}>로그인됨 · 기록이 안전하게 저장되고 있어요</span>
            {isMemberUser && onLogout && (
              <button onClick={onLogout} className="tg-press" style={{ width: '100%', height: 48, borderRadius: RADIUS.lg, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', ...TYPE.btnSm, color: TG.SUB, ...TOUCH_OPT }}>로그아웃</button>
            )}
          </div>
        )}

        {/* 고유 ID + 복사 — 계정 문제 문의 시 필요. 담백하게 카드 하단. */}
        {userId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, padding: '10px 12px', borderRadius: RADIUS.md, background: TG.SURFACE }}>
            <span style={{ ...TYPE.labelSm, color: TG.SUB, flexShrink: 0 }}>UID</span>
            <span style={{ flex: 1, minWidth: 0, ...TYPE.num, fontSize: 12, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userId}</span>
            <button onClick={copyId} aria-label="UID 복사" className="tg-press"
              style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, height: 30, padding: '0 10px', borderRadius: RADIUS.md, border: 'none', cursor: 'pointer', flexShrink: 0, background: copied ? 'rgba(54,201,141,0.14)' : '#fff', boxShadow: copied ? 'none' : '0 1px 3px rgba(43,39,48,0.1)', ...TOUCH_OPT }}>
              {copied ? <CheckCircle size={13} weight="Bold" color="#36C98D" /> : <Copy size={13} weight="Bold" color={TG.SUB} />}
              <span style={{ ...TYPE.labelSm, color: copied ? TG.SUCCESS_GLOW : TG.SUB }}>{copied ? '복사됨' : '복사'}</span>
            </button>
          </div>
        )}
    </ModalCard>
  );
}
