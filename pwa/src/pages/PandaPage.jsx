import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Content as DialogSurface } from '@radix-ui/react-dialog';
import PandaWidget, { PANDA_FEED_KEY, getPandaStorageKey } from '../components/ui/PandaWidget.jsx';
import PandaFigure from '../components/ui/PandaFigure.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { Button } from '../components/shadcn/button.jsx';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '../components/shadcn/dialog.jsx';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { PANDA_GAME_VARS } from '../constants/pandaGameTheme.js';
import usePandaDialogFocus from '../hooks/usePandaDialogFocus.js';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.js';
import '../components/ui/PandaGameView.css';
import '../components/ui/PandaUiMotion.css';
import './PandaPage.css';

export default function PandaPage() {
  const { studentToken } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const helpTriggerRef = useRef(null), exitTriggerRef = useRef(null);
  const { titleRef: helpTitleRef, ...helpFocus } = usePandaDialogFocus(helpTriggerRef);
  const { titleRef: exitTitleRef, ...exitFocus } = usePandaDialogFocus(exitTriggerRef);

  useEffect(() => {
    if (!studentToken) { navigate(-1); return undefined; }
    let cancelled = false;
    setStudent(null);
    setError(false);
    setShowHelp(false);
    setShowExit(false);
    // 학생을 구분할 수 없는 이전 공통 키만 정리한다.
    try { localStorage.removeItem(PANDA_FEED_KEY); } catch { /* 저장소를 사용할 수 없는 환경 */ }
    fetchStudentByToken(studentToken).then(data => {
      if (cancelled) return;
      setStudent(data);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [studentToken, navigate, retry]);

  const changeHelp = open => {
    setShowHelp(open);
  };
  const leave = () => {
    setShowExit(false);
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(`/personal/${studentToken}`, { replace: true });
  };
  const hasShared = !!student?.sharedAt;
  const foodSources = student ? [
    { key: 'sessions', label: '완료 수업', count: hasShared ? Math.floor((student.completedMinutes ?? 0) / 30) : 0 },
    { key: 'hw_submit', label: '숙제 제출', count: hasShared ? (student.submittedHomeworkFood ?? 0) : 0 },
    { key: 'hw_feedback', label: '피드백 확인', count: hasShared ? (student.feedbackSeenHomeworkFood ?? 0) : 0 },
  ] : [];

  return (
    <div className="panda-page" style={PANDA_GAME_VARS}>
      <div className="panda-page__shell">
        <header className="panda-page__header">
          <Button ref={exitTriggerRef} variant="ghost" size="icon" aria-label="뒤로" onClick={() => setShowExit(true)}><img src="/panda/ui/back.svg" width={24} height={24} alt="" /></Button>
          <h1>랴오랴오 키우기</h1>
          <Button ref={helpTriggerRef} variant="ghost" size="icon" aria-label="도움말" onClick={() => changeHelp(true)}><img src="/panda/ui/help.svg" width={24} height={24} alt="" /></Button>
        </header>
        <main className="panda-page__main">
          {error ? (
            <div className="panda-page__status" role="alert">
              <p>정보를 불러오지 못했어요.</p>
              <Button className="panda-game-button panda-game-button--primary" onClick={() => setRetry(value => value + 1)}>다시 시도</Button>
            </div>
          ) : !student ? <div className="panda-page__status"><LoadingSpinner /></div> : (
            <PandaWidget key={studentToken} foodSources={foodSources} storageKey={getPandaStorageKey(studentToken)} studentToken={studentToken} onOpenHelp={() => changeHelp(true)} speechPaused={showHelp || showExit} fullscreen />
          )}
        </main>
      </div>
      <Dialog open={showHelp} onOpenChange={changeHelp}>
        {(showHelp || !reducedMotion) && <DialogPortal>
          <DialogOverlay className="panda-page__overlay panda-ui-overlay" style={PANDA_GAME_VARS} />
          <DialogSurface className="panda-page__popup panda-page__popup--help panda-ui-dialog" style={PANDA_GAME_VARS} {...helpFocus} inert={!showHelp ? '' : undefined} aria-hidden={!showHelp || undefined}>
            <DialogTitle ref={helpTitleRef} tabIndex={-1} className="panda-page__popup-title">랴오랴오와 함께 자라요</DialogTitle>
            <DialogDescription className="sr-only">먹이 획득, 성장 단계와 아이템 구매 안내</DialogDescription>
            <ol className="panda-page__growth-strip">
              {['알', '깨어남', '아기', '어린이', '청소년', '성인'].map((label, stage) => <li key={label}><PandaFigure width={42} stage={stage} decorative /><span>{label}</span></li>)}
            </ol>
            <div className="panda-page__help-copy">
              <section><h3>먹이는 어떻게 얻나요?</h3><p>완료한 수업 30분마다 먹이가 생겨요.<br />일부 숙제 활동으로도 받을 수 있어요.</p></section>
              <section><h3>다 자란 뒤에도 계속 성장해요</h3><p>먹이를 주면 경험치와 레벨이 올라가요.<br />6단계 성체부터 꾸미기를 시작할 수 있어요.</p></section>
              <section><h3>아이템은 어떻게 얻나요?</h3><p>필요 레벨에 도달하면 먹이로 살 수 있어요.<br />구매해도 경험치는 오르지 않아요.</p></section>
            </div>
            <Button className="panda-game-button panda-game-button--primary" onClick={() => changeHelp(false)}>알겠어요</Button>
          </DialogSurface>
        </DialogPortal>}
      </Dialog>
      <Dialog open={showExit} onOpenChange={setShowExit}>
        {(showExit || !reducedMotion) && <DialogPortal>
          <DialogOverlay className="panda-page__overlay panda-ui-overlay" style={PANDA_GAME_VARS} />
          <DialogSurface className="panda-page__popup panda-page__popup--exit panda-ui-dialog" style={PANDA_GAME_VARS} {...exitFocus} inert={!showExit ? '' : undefined} aria-hidden={!showExit || undefined}>
            <PandaFigure width={80} stage={5} decorative />
            <DialogTitle ref={exitTitleRef} tabIndex={-1} className="panda-page__popup-title">잠깐, 벌써 가려고요?</DialogTitle>
            <DialogDescription className="panda-page__popup-description">랴오랴오 키우기를 나갈까요?<br />언제든 다시 만나러 와 주세요.</DialogDescription>
            <div className="panda-page__exit-actions">
              <Button className="panda-game-button panda-game-button--secondary" onClick={leave}>나가기</Button>
              <Button className="panda-game-button panda-game-button--primary" onClick={() => setShowExit(false)}>계속하기</Button>
            </div>
          </DialogSurface>
        </DialogPortal>}
      </Dialog>
    </div>
  );
}
