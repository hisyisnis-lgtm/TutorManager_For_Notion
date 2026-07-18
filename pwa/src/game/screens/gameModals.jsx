// 게임 공용 모달 — 놀러가기(SNS)·복습 시작·게임방법·무한 안내·로그인 유도·[DEV]점수 디버그. 시작/홈 등 여러 화면에서 재사용.
// (기존 StartScreen.jsx 내부 함수에서 추출)
import { useState } from 'react';
import { HandWavingIcon, InstagramLogoIcon, YoutubeLogoIcon, ArticleIcon, CaretRightIcon, PlayIcon, InfinityIcon, StarIcon, QuestionIcon, DevicesIcon, SignInIcon, GraduationCapIcon } from '@phosphor-icons/react';
import { TG, TYPE, SHADOW, TOUCH_OPT, loadBest, saveBest } from '../tgTokens.js';
import { GAMEKEY, loadEndlessBest, saveEndlessBest } from '../gameLogic.js';
import { DIFFICULTIES } from '../../constants/toneGameWords.js';
import { track } from '../gameAnalytics.js';
import { ModalCard, PrimaryButton } from './shared.jsx';

// 게임 방법 확인 모달 — 메뉴 '게임 방법' 시. 튜토리얼을 다시 볼지 확인 후 [게임 방법 보기] 눌러야 진입.
export function HelpStartModal({ onStart, onClose }) {
  return (
    <ModalCard onClose={onClose}>
      <div style={{ width: 72, height: 72, borderRadius: 36, background: 'rgba(255,107,107,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <QuestionIcon size={32} weight="fill" color={TG.CORAL_DK} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', width: '100%' }}>
        <span style={{ ...TYPE.titleLg, color: TG.INK }}>게임 방법</span>
        <span style={{ ...TYPE.sub, lineHeight: 1.55, color: TG.SUB }}>
          성조 게임 조작법을 처음부터<br />다시 볼까요?
        </span>
      </div>
      <PrimaryButton onClick={() => { onStart && onStart(); }}>
        <span style={{ ...TYPE.cta, color: '#fff' }}>게임 방법 보기</span>
        <PlayIcon size={14} weight="fill" color="#fff" />
      </PrimaryButton>
      <button className="tg-press" onClick={onClose} style={{ width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
        <span style={{ ...TYPE.body, color: TG.SUB }}>닫기</span>
      </button>
    </ModalCard>
  );
}

// 무한 시작 모달 — 모드선택 '무한' 카드 시. 서든데스·건너뛰기 규칙 안내 + 최고점 + [게임 시작] 눌러야 진입.
export function EndlessStartModal({ best = 0, onStart, onClose }) {
  return (
    <ModalCard onClose={onClose}>
      <div style={{ width: 72, height: 72, borderRadius: 24, background: 'linear-gradient(135deg,#ffcf5b,#F0A91E)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 26px rgba(240,169,30,0.4)' }}>
        <InfinityIcon size={40} weight="bold" color="#fff" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', width: '100%' }}>
        <span style={{ ...TYPE.titleLg, color: TG.INK }}>무한 모드</span>
        <span style={{ ...TYPE.sub, lineHeight: 1.55, color: TG.SUB }}>
          점점 빨라지는 문제를 계속 풀어요.<br /><b style={{ color: '#d0464a', fontWeight: 800 }}>한 번이라도 틀리면 끝!</b><br />모르는 단어는 건너뛰기 패스로 넘기세요.
        </span>
      </div>
      {best > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,176,46,0.14)', padding: '7px 14px', borderRadius: 999 }}>
          <StarIcon size={15} weight="fill" color={TG.SUN} />
          <span style={{ ...TYPE.labelSm, color: TG.INK }}>최고 {best.toLocaleString()}점</span>
        </div>
      )}
      <PrimaryButton onClick={() => { onStart && onStart(); }}>
        <span style={{ ...TYPE.cta, color: '#fff' }}>게임 시작</span>
        <PlayIcon size={14} weight="fill" color="#fff" />
      </PrimaryButton>
      <button className="tg-press" onClick={onClose} style={{ width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
        <span style={{ ...TYPE.body, color: TG.SUB }}>닫기</span>
      </button>
    </ModalCard>
  );
}

// 트레이닝 시작 모달 — 모드선택 '트레이닝' 카드 시. 무엇을 하는 모드인지 안내 + [트레이닝 시작] 눌러야 진입.
//   트레이닝 = 열린 스테이지 범위의 약점가중 단어를 시간제한 없이 무한 반복(기록 미반영).
export function TrainingStartModal({ onStart, onClose }) {
  return (
    <ModalCard onClose={onClose}>
      <div style={{ width: 72, height: 72, borderRadius: 24, background: 'linear-gradient(135deg,#4ad4a0,#2bb583)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 26px rgba(43,181,131,0.4)' }}>
        <GraduationCapIcon size={38} weight="fill" color="#fff" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', width: '100%' }}>
        <span style={{ ...TYPE.titleLg, color: TG.INK }}>트레이닝</span>
        <span style={{ ...TYPE.sub, lineHeight: 1.6, color: TG.SUB }}>
          지금 열린 범위에서 <b style={{ color: TG.INK, fontWeight: 700 }}>약한 단어 위주</b>로 골라줘요.<br />
          <b style={{ color: '#2bb583', fontWeight: 800 }}>시간 제한 없이</b> 계속 이어서 연습해요.<br />
          기록에는 반영되지 않으니 부담 없이!
        </span>
      </div>
      <PrimaryButton onClick={() => { onStart && onStart(); }} background="linear-gradient(135deg,#3ccf97,#2bb583)" shadow="0px 10px 20px rgba(43,181,131,0.32)">
        <span style={{ ...TYPE.cta, color: '#fff' }}>트레이닝 시작</span>
        <PlayIcon size={14} weight="fill" color="#fff" />
      </PrimaryButton>
      <button className="tg-press" onClick={onClose} style={{ width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
        <span style={{ ...TYPE.body, color: TG.SUB }}>닫기</span>
      </button>
    </ModalCard>
  );
}

// 로그인 유도 모달 — 게스트가 이전 기록을 넘긴 순간(결과 화면). 기기 저장(정직) 안내 + 로그인 버튼.
export function LoginNudgeModal({ onLogin, onClose }) {
  return (
    <ModalCard onClose={onClose} zIndex={65}>
      <div style={{ width: 72, height: 72, borderRadius: 36, background: 'rgba(255,107,107,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <DevicesIcon size={32} weight="fill" color={TG.CORAL_DK} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', width: '100%' }}>
        <span style={{ ...TYPE.titleLg, color: TG.INK }}>어디서든 이어가기</span>
        <span style={{ ...TYPE.sub, lineHeight: 1.55, color: TG.SUB }}>
          기록은 지금 <b style={{ color: TG.INK, fontWeight: 700 }}>이 기기에 저장</b>돼 있어요.<br />로그인하면 다른 기기에서도 이어서 할 수 있어요.
        </span>
      </div>
      <PrimaryButton onClick={() => { onLogin && onLogin(); }}>
        <SignInIcon size={18} weight="bold" color="#fff" />
        <span style={{ ...TYPE.cta, color: '#fff' }}>로그인</span>
      </PrimaryButton>
      <button className="tg-press" onClick={onClose} style={{ width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
        <span style={{ ...TYPE.body, color: TG.SUB }}>나중에</span>
      </button>
    </ModalCard>
  );
}

// SNS 링크 (PersonalPage와 동일 URL). 인스타그램이 메인, 유튜브·블로그는 보조.
export const PLAY_LINKS = {
  instagram: { href: 'https://www.instagram.com/tiantian_laoshi?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==', handle: '@tiantian_laoshi' },
  youtube: { id: 'youtube', href: 'https://www.youtube.com/@tiantian_chinese', label: '유튜브', color: '#FF0000', Icon: YoutubeLogoIcon },
  blog: { id: 'blog', href: 'https://blog.naver.com/tiantian_chinese/224100509217', label: '블로그', color: '#03C75A', Icon: ArticleIcon },
};

// '놀러가기' 모달 — 인스타그램(메인 그라데이션) + 유튜브·블로그(보조). Figma "14. 놀러가기" 기준.
export function PlayModal({ onClose }) {
  // 측정: 게임→채널 전환 클릭(유입 깔때기의 출구) — 채널 라벨만(PII 없음)
  const openLink = (href, channel) => { track('cta_play_link', { m: channel }); try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* noop */ } };
  return (
    <ModalCard onClose={onClose} padding="28px 24px 24px" gap={18}>
      <div style={{ width: 72, height: 72, borderRadius: 36, background: 'rgba(255,107,107,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <HandWavingIcon size={30} weight="fill" color={TG.CORAL_DK} />
      </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', width: '100%' }}>
          <span style={{ ...TYPE.titleLg, color: TG.INK }}>놀러 오세요</span>
          <span style={{ ...TYPE.sub, color: TG.SUB }}>하늘쌤 채널에서 더 많은 중국어 이야기를</span>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="tg-press" onClick={() => openLink(PLAY_LINKS.instagram.href, 'instagram')} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 18, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)', boxShadow: '0 8px 16px rgba(221,42,123,0.3)', ...TOUCH_OPT,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 24, background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <InstagramLogoIcon size={26} weight="fill" color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
              <span style={{ ...TYPE.btn, color: '#fff' }}>인스타그램</span>
              <span style={{ ...TYPE.meta, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{PLAY_LINKS.instagram.handle}</span>
            </div>
            <CaretRightIcon size={20} weight="bold" color="#fff" style={{ opacity: 0.9, flexShrink: 0 }} />
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            {[PLAY_LINKS.youtube, PLAY_LINKS.blog].map((s) => (
              <button key={s.label} className="tg-press" onClick={() => openLink(s.href, s.id)} style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px 0', borderRadius: 14,
                background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT,
              }}>
                <s.Icon size={20} weight="fill" color={s.color} />
                <span style={{ ...TYPE.label, color: TG.INK }}>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="tg-press" onClick={onClose} style={{ width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
          <span style={{ ...TYPE.body, color: TG.SUB }}>닫기</span>
        </button>
    </ModalCard>
  );
}

// [디버그] 점수 기록 설정 모달 — 잠금 사다리/무한 해제/헤드라인 테스트용(import.meta.env.DEV에서만 렌더).
export function DebugScoreModal({ studentToken, onClose, onApplied }) {
  const [v, setV] = useState(() => ({
    easy: loadBest(studentToken, GAMEKEY.easy)?.bestScore || 0,
    normal: loadBest(studentToken, GAMEKEY.normal)?.bestScore || 0,
    hard: loadBest(studentToken, GAMEKEY.hard)?.bestScore || 0,
    endless: loadEndlessBest(studentToken)?.bestScore || 0,
  }));
  const rows = [...DIFFICULTIES.map((d) => [d.id, d.label]), ['endless', '무한']];
  const apply = () => {
    for (const id of ['easy', 'normal', 'hard']) {
      const prev = loadBest(studentToken, GAMEKEY[id]) || {};
      saveBest(studentToken, GAMEKEY[id], { ...prev, bestScore: Number(v[id]) || 0, updatedAt: Date.now() });
    }
    const prevE = loadEndlessBest(studentToken) || {};
    saveEndlessBest(studentToken, { ...prevE, bestScore: Number(v.endless) || 0, updatedAt: Date.now() });
    onApplied(); onClose();
  };
  return (
    <ModalCard onClose={onClose} maxWidth={320} radius={24} padding="22px 20px 18px" gap={12} align="stretch">
        <span style={{ ...TYPE.head, fontSize: 19, color: TG.INK, textAlign: 'center' }}>🛠 점수 디버그</span>
        {rows.map(([k, label]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ ...TYPE.label, color: TG.INK }}>{label}</span>
            <input type="number" value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
              style={{ width: 120, height: 38, borderRadius: 10, border: '1.5px solid #ebe5de', padding: '0 12px', textAlign: 'right', ...TYPE.num, fontSize: 15, color: TG.INK, background: '#fff' }} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button onClick={() => setV((s) => ({ ...s, easy: 1000, normal: 1000, hard: 1000 }))} className="tg-press" style={{ flex: 1, height: 40, borderRadius: 12, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', ...TYPE.labelSm, color: TG.INK, ...TOUCH_OPT }}>난이도 모두 1000</button>
          <button onClick={() => setV({ easy: 0, normal: 0, hard: 0, endless: 0 })} className="tg-press" style={{ flex: 1, height: 40, borderRadius: 12, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', ...TYPE.labelSm, color: TG.SUB, ...TOUCH_OPT }}>초기화</button>
        </div>
        <button onClick={apply} className="tg-press" style={{ width: '100%', height: 50, borderRadius: 16, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: SHADOW.btn, color: '#fff', ...TYPE.btn, marginTop: 4, ...TOUCH_OPT }}>적용</button>
        <button onClick={onClose} className="tg-press" style={{ width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', ...TYPE.sub, color: TG.SUB, ...TOUCH_OPT }}>닫기</button>
    </ModalCard>
  );
}
