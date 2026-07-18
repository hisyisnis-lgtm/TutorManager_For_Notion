// 타이틀 → 홈 전환 오버레이 안에 들어가는 팁 카드(프레젠테이셔널). 타이밍/슬라이드는 ToneGamePage(homeTx)가 제어.
// 성조 캐릭터 1개(랜덤)가 팁을 건네는 톤. 팁이 특정 성조 설명이면 그 성조 캐릭터를 보여줌.
// 배경(빨강)·웨이브 슬라이드는 감싸는 오버레이가 제공 → 캐릭터 뒤 흰 원으로 성조색 대비 확보.
import { useState } from 'react';
import { TG, TYPE, RADIUS, SPACE } from '../tgTokens.js';
import { TONES } from '../../constants/toneGameWords.js';
import { ToneMark } from '../tgWidgets.jsx';
import { Eyes, markSize } from './eyes.jsx';

// { t: 팁, tone: 연관 성조(null=일반→랜덤 캐릭터) }
const TIPS = [
  { t: '1성 ˉ 은 높고 평평하게, 4성 ˋ 은 위에서 아래로 강하게!', tone: 1 },
  { t: '2성 ˊ 은 끝을 올리고, 3성 ˇ 은 내렸다가 살짝 올려요.', tone: 3 },
  { t: '경성은 짧고 가볍게 — 앞 글자에 살짝 얹듯이.', tone: 0 },
  { t: '홈에서 성조 친구를 탭하면 그 성조의 정확도를 볼 수 있어요.', tone: null },
  { t: '매일 한 판이면 연속학습이 쌓여요. 보호권이 하루 빠짐을 막아줘요.', tone: null },
  { t: '정확도가 높을수록 성조 친구가 무럭무럭 자라요.', tone: null },
  { t: '헷갈리는 성조는 천천히 여러 번 — 귀가 곧 트여요.', tone: null },
];

export function LoadingTip() {
  const [pick] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const [randTone] = useState(() => TONES[Math.floor(Math.random() * TONES.length)].num);
  const toneNum = pick.tone != null ? pick.tone : randTone;
  const tone = TONES.find((t) => t.num === toneNum) || TONES[0];
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}>
      {/* 성조 캐릭터 — 흰 원 스포트라이트 위에서 둥둥 */}
      <div style={{ position: 'relative', width: 112, height: 112, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#fff', boxShadow: '0 8px 20px rgba(0,0,0,0.14)' }} />
        <div style={{ position: 'relative', color: tone.color, animation: 'tg-bob 2.4s ease-in-out infinite' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <ToneMark tone={tone.num} size={markSize(tone.num)} />
            {/* 캐릭터 1개뿐이라 시차 불필요 — i=0(기존 딜레이 없음과 동일) */}
            <Eyes num={tone.num} i={0} />
          </div>
        </div>
      </div>
      {/* 팁 카드 */}
      <div className="tg-enter" style={{ marginTop: SPACE.x3, width: '100%', maxWidth: 320, background: TG.CARD, borderRadius: RADIUS.xl, padding: '18px 20px', boxShadow: '0 8px 24px rgba(43,39,48,0.08)', textAlign: 'center' }}>
        <span style={{ ...TYPE.labelSm, color: TG.CORAL_DK, letterSpacing: 0.3 }}>💡 오늘의 팁</span>
        <p style={{ margin: '8px 0 0', ...TYPE.body, lineHeight: 1.55, color: TG.INK }}>{pick.t}</p>
      </div>
      {/* 진행바 — 오버레이가 덮은 동안 채워짐(hold~약 2.8s). 빨강 배경 대비 위해 흰색 */}
      <div style={{ marginTop: SPACE.x4, width: 170, height: 7, borderRadius: RADIUS.xs, background: 'rgba(255,255,255,0.28)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: RADIUS.xs, background: '#fff', animation: 'tg-loadbar 2800ms cubic-bezier(.35,0,.25,1) forwards' }} />
      </div>
    </div>
  );
}
