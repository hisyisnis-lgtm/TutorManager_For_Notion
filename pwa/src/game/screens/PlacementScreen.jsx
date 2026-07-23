// 첫 진입 "시작하기" — ①입문부터 차근차근 ②듀오링고식 적응형 실력 테스트(전 급 혼합·정답에 따라 난이도 오르내리며 급 자동 배정).
//  하단 2단 버튼: '입문으로 시작하기'(보조) / '테스트 시작하기'(주력→startPlacement). 급 선택 단계 없음(적응형이 알아서 배정).
import { GraduationCapIcon, CaretRightIcon } from '@phosphor-icons/react';
import { TG, TYPE, RADIUS, SPACE, TOUCH_OPT } from '../tgTokens.js';
import { GameHeader, Reveal } from './shared.jsx';
import { DIFFICULTIES } from '../../constants/toneGameWords.js';

export function PlacementScreen({ onLadder, onStartTest, onBack }) {
  const FIRST = DIFFICULTIES[0].label; // 입문
  return (
    <>
      <GameHeader title="시작하기" onBack={onBack} />
      {/* 테스트 안내 히어로 (하단 버튼 영역 위 공간 세로중앙) */}
      <div style={{ position: 'absolute', left: SPACE.x4, right: SPACE.x4, top: 'calc(64px + env(safe-area-inset-top))', bottom: 'calc(160px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column' }}>
        <div className="tg-reveal" style={{ animationDelay: '120ms', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.x2, textAlign: 'center' }}>
          <div style={{ width: 92, height: 92, borderRadius: RADIUS.xxl, background: 'linear-gradient(135deg,#9a7cff,#7c5cff)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 30px rgba(124,92,255,0.35)' }}>
            <GraduationCapIcon size={48} weight="fill" color="#fff" />
          </div>
          <span style={{ ...TYPE.title, color: TG.INK }}>중국어 단어 실력 테스트</span>
          <span style={{ ...TYPE.sub, color: TG.SUB, lineHeight: 1.55 }}>모든 급의 단어로 실력을 확인하고<br />바로 내 급부터 시작할 수 있어요</span>
        </div>
      </div>
      {/* 하단 2단 버튼 — 입문으로 시작하기(보조) / 테스트 시작하기(주력) */}
      <div style={{ position: 'absolute', left: SPACE.x4, right: SPACE.x4, bottom: 'calc(30px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
        <Reveal i={2} style={{ width: '100%' }}>
          <button onClick={onLadder} className="tg-press" style={{ width: '100%', height: 58, borderRadius: RADIUS.btn, background: TG.CARD, border: `1.5px solid ${TG.BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <span style={{ ...TYPE.cta, color: TG.INK }}>{`${FIRST}으로 시작하기`}</span>
          </button>
        </Reveal>
        <Reveal i={3} style={{ width: '100%' }}>
          <button onClick={onStartTest} className="tg-press" style={{ width: '100%', height: 58, borderRadius: RADIUS.btn, background: TG.CORAL_GRAD, border: 'none', cursor: 'pointer', boxShadow: '0 10px 22px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, ...TOUCH_OPT }}>
            <span style={{ ...TYPE.cta, color: '#fff' }}>테스트 시작하기</span>
            <CaretRightIcon size={18} weight="bold" color="#fff" />
          </button>
        </Reveal>
      </div>
    </>
  );
}
