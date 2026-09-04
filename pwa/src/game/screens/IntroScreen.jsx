// 소개 화면 (1페이지, Figma 좌표 절대배치) — 게임 기원 스토리.
// 시안(756:2): 글래스 헤더('게임 소개') / 히어로 카드(24,90 342×190) / 좌측정렬 텍스트(24,300)
//   / 하단 고정 키캡 CTA(342×60, 하단 26).
// ※ 2·3페이지("눈이 아니라 반응으로" / "기록 깨는 재미로")는 2026-08-08 사용자 요청으로 삭제.
//    캐러셀(슬라이딩 트랙·점 인디케이터)과 히어로 2종(PaceCard·RecordCard)도 함께 제거 — 첫 장 하나로 끝난다.
import { TG, TYPE, FONT_HANZI, FONT_BODY, RADIUS, SPACE, SHADOW } from '../tgTokens.js';
import { ToneMark } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, GameHeader, KeycapCta } from './shared.jsx';

const HERO_H = 190, TEXT_W = 267;

const INTRO = {
  title: '하늘쌤의 공부법에서 시작했어요',
  body: ['유학 시절, 병음 없는 중국어에 성조를 직접', '적어가며 회화를 익혔던 하늘쌤.', '그 연습법을 그대로 게임에 담았어요.'],
  cta: '직접 해볼까요?',
};

// 히어로 카드 — 시안 342×190 흰 카드
const HERO_CARD = {
  width: '100%', height: HERO_H, background: '#fff', borderRadius: RADIUS.xl,
  boxShadow: SHADOW.level1,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
};

// 히어로 내용 — '我爱你' 위에 성조만 직접 표기한 노트(열 폭 52·열 간격 20)
function NoteCard() {
  return (
    <div style={{ ...HERO_CARD, gap: 18 }}>
      <div style={{ display: 'flex', gap: SPACE.x3, alignItems: 'center' }}>
        {[['我', 3], ['爱', 4], ['你', 3]].map(([ch, tn]) => (
          <div key={ch} style={{ width: 52, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', color: TONES.find((t) => t.num === tn)?.color }}>
            <ToneMark tone={tn} size={26} />
            <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 52, lineHeight: '62.4px', color: TG.INK }}>{ch}</span>
          </div>
        ))}
      </div>
      <span style={{ ...TYPE.label, color: TG.SUB, whiteSpace: 'nowrap' }}>병음 없이 · 성조만 직접 표기</span>
    </div>
  );
}

// onNext — 소개를 마치고 튜토리얼로. (한 장뿐이라 '건너뛰기'는 CTA와 동작이 같아져 제거됨)
export function IntroScreen({ onNext }) {
  return (
    <>
      <GameHeader title="게임 소개" center glass />

      {/* 히어로 카드 + 텍스트를 한 블록으로 묶어 헤더~CTA 사이 세로 중앙에 앉힌다(2026-09-03).
          구 시안은 y90/y300 절대배치라 844 화면에서 아래 절반이 비었다. 블록 내부 간격(20)은 고정 px. */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: 60, bottom: 'calc(112px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: SPACE.x3 }}>
        <Reveal i={0}>
          <NoteCard />
        </Reveal>

        {/* 제목 26/36 + 본문 14/25 — 시안 좌측정렬, 폭 267(줄바꿈 위치 고정) */}
        <Reveal i={1} style={{ width: TEXT_W }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            <span style={{ ...TYPE.head, fontSize: 26, lineHeight: '36px', color: TG.INK }}>{INTRO.title}</span>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14, lineHeight: '25px', color: TG.SUB }}>
              {INTRO.body.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
        </Reveal>
      </div>

      {/* CTA — 하단 26의 키캡 버튼 */}
      <KeycapCta label={INTRO.cta} onClick={() => { playSfx('button'); onNext(); }}
        style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(26px + env(safe-area-inset-bottom))', zIndex: 3, width: 'auto' }} />
    </>
  );
}
