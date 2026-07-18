// 프로필 모달 — 홈 상단 내 정보 카드(MyInfo) 탭 시 항상 먼저 뜬다(게스트·회원 공통).
// 로그인 상태 + 닉네임(+수정) + 등급(엠블럼·게이지)을 한 곳에서 보여주고,
// 게스트면 SNS 로그인 버튼을, 회원이면 로그아웃을 노출한다.
// 시각 패턴은 NicknameEditModal·HomeMenu와 통일(다크 오버레이 + 카드). SNS 버튼/로그인 시작은 LoginScreen 공용.
import { useState } from 'react';
import { PencilSimpleIcon, XIcon, CaretRightIcon, MedalIcon, CopyIcon, CheckIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT } from '../tgTokens.js';
import { startSocialLogin, KakaoLogo, GoogleLogo } from './LoginScreen.jsx';
import { ModalCard } from './shared.jsx';

export function ProfileModal({
  tier, nickname, isGuest, isMemberUser, userId,
  onEditNickname, onExam, onLogout, onMastery, onClose,
}) {
  const displayName = nickname || '게스트';
  const pct = tier.isMax ? 100 : Math.round(tier.progress * 100);
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
            <span style={{ width: 30, height: 30, borderRadius: 15, background: '#f3efe9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <XIcon size={14} weight="bold" color={TG.SUB} />
            </span>
          </button>
        </div>

        {/* 프로필 — 엠블럼 + 닉네임(+수정) + 등급명·게이지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src={tier.emblem} alt="" width={64} height={64} style={{ display: 'block', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 닉네임 + 수정 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...TYPE.h1, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
              {onEditNickname && (
                <button onClick={onEditNickname} aria-label="닉네임 수정" className="tg-press"
                  style={{ width: 30, height: 30, margin: -4, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
                  <span style={{ width: 24, height: 24, borderRadius: 8, background: TG.CORAL_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <PencilSimpleIcon size={13} weight="fill" color={TG.CORAL_DK} />
                  </span>
                </button>
              )}
            </div>
            <span style={{ ...TYPE.labelSm, color: TG.SUB }}>{tier.name}</span>
            <div style={{ marginTop: 8, width: '100%', height: 6, borderRadius: 3, background: '#ece5da', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: TG.CORAL_GRAD, transition: 'width .5s ease' }} />
            </div>
            <span style={{ display: 'block', marginTop: 5, ...TYPE.meta, color: TG.SUB }}>{tier.isMax ? '최고 등급이에요 🎉' : (tier.examReady ? '승급 시험을 볼 수 있어요!' : `다음 등급까지 ${tier.toNext.toLocaleString()} XP`)}</span>
          </div>
        </div>

        {/* 승급 시험 CTA — 게이지 만땅(examReady)일 때만. 합격하면 등급 상승. */}
        {onExam && (
          <button onClick={onExam} className="tg-press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 52, borderRadius: 14, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: '0 8px 18px rgba(242,72,76,0.3)', ...TOUCH_OPT }}>
            <MedalIcon size={19} weight="fill" color="#fff" />
            <span style={{ ...TYPE.btnSm, color: '#fff' }}>승급 시험 보기</span>
          </button>
        )}

        {/* 등급 자세히 — 기존 카드 탭(→ 등급 화면) 동선 보존 */}
        {onMastery && (
          <button onClick={onMastery} className="tg-press" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 12px', borderRadius: 14, background: '#f7f3ee', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(240,169,30,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <MedalIcon size={17} weight="fill" color="#F0A91E" />
            </div>
            <span style={{ flex: 1, textAlign: 'left', ...TYPE.label, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>등급 자세히 보기</span>
            <CaretRightIcon size={16} weight="bold" color="#c9c2bb" />
          </button>
        )}

        <div style={{ height: 1, background: '#efeae4' }} />

        {/* 로그인 상태 */}
        {isGuest ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ ...TYPE.sub, color: TG.SUB, textAlign: 'center' }}>로그인하면 기기를 바꿔도 기록이 그대로예요</span>
            <button onClick={() => startSocialLogin('kakao')} className="tg-press" style={{ width: '100%', height: 52, borderRadius: 14, border: 'none', background: '#FEE500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', ...TOUCH_OPT }}>
              <KakaoLogo />
              <span style={{ ...TYPE.btnSm, color: 'rgba(0,0,0,0.85)' }}>카카오로 시작하기</span>
            </button>
            <button onClick={() => startSocialLogin('google')} className="tg-press" style={{ width: '100%', height: 52, borderRadius: 14, border: '1px solid #747775', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', ...TOUCH_OPT }}>
              <GoogleLogo />
              <span style={{ ...TYPE.btnSm, color: '#1f1f1f' }}>Google로 계속하기</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ ...TYPE.sub, color: TG.SUB, textAlign: 'center' }}>로그인됨 · 기록이 안전하게 저장되고 있어요</span>
            {isMemberUser && onLogout && (
              <button onClick={onLogout} className="tg-press" style={{ width: '100%', height: 48, borderRadius: 14, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', ...TYPE.btnSm, color: TG.SUB, ...TOUCH_OPT }}>로그아웃</button>
            )}
          </div>
        )}

        {/* 고유 ID + 복사 — 계정 문제 문의 시 필요. 담백하게 카드 하단. */}
        {userId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, background: '#f7f3ee' }}>
            <span style={{ ...TYPE.labelSm, color: TG.SUB, flexShrink: 0 }}>UID</span>
            <span style={{ flex: 1, minWidth: 0, ...TYPE.num, fontSize: 12, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userId}</span>
            <button onClick={copyId} aria-label="UID 복사" className="tg-press"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px', borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0, background: copied ? 'rgba(54,201,141,0.14)' : '#fff', boxShadow: copied ? 'none' : '0 1px 3px rgba(43,39,48,0.1)', ...TOUCH_OPT }}>
              {copied ? <CheckIcon size={13} weight="bold" color="#36C98D" /> : <CopyIcon size={13} weight="fill" color={TG.SUB} />}
              <span style={{ ...TYPE.labelSm, color: copied ? '#36C98D' : TG.SUB }}>{copied ? '복사됨' : '복사'}</span>
            </button>
          </div>
        )}
    </ModalCard>
  );
}
