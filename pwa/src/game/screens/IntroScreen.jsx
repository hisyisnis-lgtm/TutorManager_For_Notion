// 소개 화면 (3페이지 캐러셀, Figma 좌표 절대배치) — 게임 기원 스토리.
import { LightningIcon, TrophyIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, FONT_HANZI, TOUCH_OPT } from '../tgTokens.js';
import { ToneMark } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal } from './shared.jsx';

const INTRO_PAGES = [
  {
    kind: 'note',
    title: '하늘쌤의 공부법에서 시작했어요',
    body: ['유학 시절, 병음 없는 중국어에 성조를 직접', '적어가며 회화를 익혔던 하늘쌤.', '그 연습법을 그대로 게임에 담았어요.'],
    cta: '다음', tcolTop: '41.9%',
  },
  {
    kind: 'icon', Icon: LightningIcon, iconColor: '#F2484C', circleBg: 'rgba(255,107,107,0.14)',
    tag: '성조를 빠르게 캐치!', tagColor: '#f2484c', tagBg: 'rgba(255,107,107,0.16)',
    title: '눈이 아니라 반응으로',
    body: ['성조를 빠르게 알아채는 게 회화의 진짜', '실력이에요. 반복해서 찾다 보면 머리가', '아니라 입이 먼저 기억해요.'],
    cta: '다음', tcolTop: '43.1%',
  },
  {
    kind: 'icon', Icon: TrophyIcon, iconColor: '#F0A91E', circleBg: 'rgba(255,194,60,0.16)',
    tag: '최고 기록에 도전!', tagColor: '#b07d12', tagBg: 'rgba(255,194,60,0.18)',
    title: '기록 깨는 재미로, 매일',
    body: ['지난 최고 기록을 넘볼 때의 짜릿함.', '어제의 나와 겨루다 보면,', '하루 1분이 어느새 습관이 돼요.'],
    cta: '직접 해볼까요?', tcolTop: '43.1%',
  },
];

// 소개 한 페이지 내용(일러스트+제목+본문) — 슬라이딩 트랙의 각 패널
function IntroPanel({ p }) {
  return (
    <>
      {p.kind === 'note' ? (
        <Reveal i={0} style={{ position: 'absolute', left: 0, right: 0, top: '16.5%' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 26, boxShadow: '0px 10px 28px rgba(43,39,48,0.08)', padding: '26px 30px 22px', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              {[['我', 3], ['爱', 4], ['你', 3]].map(([ch, tn]) => (
                <div key={ch} style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', color: TONES.find((t) => t.num === tn)?.color }}>
                  <ToneMark tone={tn} size={26} />
                  <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 52, color: '#2b2730', lineHeight: 1 }}>{ch}</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#fff6e8', padding: '7px 14px', borderRadius: 14 }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: '#b07d12', whiteSpace: 'nowrap' }}>병음 없이 · 성조만 직접 표기</span>
            </div>
          </div>
        </div>
        </Reveal>
      ) : (
        <Reveal i={0} style={{ position: 'absolute', left: 0, right: 0, top: '19.8%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 112, height: 112, borderRadius: 56, background: p.circleBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p.Icon size={52} weight="fill" color={p.iconColor} />
          </div>
          <div style={{ background: p.tagBg, padding: '7px 14px', borderRadius: 14 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: p.tagColor, whiteSpace: 'nowrap' }}>{p.tag}</span>
          </div>
        </div>
        </Reveal>
      )}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: p.tcolTop }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 28, color: '#2b2730', letterSpacing: -0.3, width: '100%' }}>{p.title}</span>
        <div style={{ width: '100%', fontFamily: FONT_BODY, fontWeight: 500, fontSize: 15, color: '#9a93a0', lineHeight: 1.65 }}>
          {p.body.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>
      </Reveal>
    </>
  );
}

export function IntroScreen({ page, onNext, onSkip }) {
  const cur = INTRO_PAGES[page];
  return (
    <>
      {/* 건너뛰기 (고정) */}
      <button onClick={() => { playSfx('button'); onSkip(); }} className="tg-press" style={{ position: 'absolute', right: 24, top: 18, zIndex: 3, padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0' }}>건너뛰기</span>
      </button>

      {/* 슬라이딩 트랙 — 일러스트+제목+본문이 좌우로 슬라이드 */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', width: '300%', height: '100%', transform: `translateX(-${page * (100 / 3)}%)`, transition: 'transform .38s cubic-bezier(.4,0,.2,1)' }}>
          {INTRO_PAGES.map((p, idx) => (
            <div key={idx} style={{ position: 'relative', width: `${100 / 3}%`, height: '100%', flexShrink: 0 }}>
              <IntroPanel p={p} />
            </div>
          ))}
        </div>
      </div>

      {/* 점 인디케이터 (고정) — CTA(89.35%) 위 gap 유지 */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: '84.85%', zIndex: 3, height: 28, display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 8, width: i === page ? 22 : 8, borderRadius: 4, background: i === page ? '#ff6b6b' : '#e2dbd3', transition: 'width .25s ease, background .25s ease' }} />
        ))}
      </div>

      {/* CTA (고정) — 하단 여백 30px 상당(=89.35%) */}
      <button onClick={() => { playSfx('button'); onNext(); }} className="tg-press" style={{ position: 'absolute', left: 24, right: 24, top: '89.35%', zIndex: 3, height: 60, borderRadius: 20, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 18, color: '#fff' }}>{cur.cta}</span>
      </button>
    </>
  );
}
