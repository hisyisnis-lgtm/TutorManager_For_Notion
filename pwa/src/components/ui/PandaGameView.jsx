import { useEffect, useId, useRef, useState } from 'react';
import { Content as DialogSurface } from '@radix-ui/react-dialog';
import { XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from '../shadcn/button.jsx';
import { Input } from '../shadcn/input.jsx';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '../shadcn/dialog.jsx';
import { PANDA_GAME_VARS } from '../../constants/pandaGameTheme.js';
import { PANDA_STAGE_LABELS } from '../../constants/pandaMascot.js';
import { PANDA_ADULT_LEVEL, PANDA_GROWTH_THRESHOLDS, getPandaLevelInfo } from '../../constants/pandaWardrobe.js';
import { PANDA_NAME_MAX_LENGTH } from '../../constants/pandaGameState.js';
import PandaFigure, { getPandaFigureGroundPoint } from './PandaFigure.jsx';
import PandaRoomBackdrop from './PandaRoomBackdrop.jsx';
import PandaGrowthEffects from './PandaGrowthEffects.jsx';
import PandaUiPresence from './PandaUiPresence.jsx';
import usePandaDialogFocus from '../../hooks/usePandaDialogFocus.js';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';
import '@fontsource/jua/korean-400.css';
import './PandaGameView.css';
import './PandaUiMotion.css';

const UI_ASSETS = '/panda/ui/';
const NO_FOOD = '먹이가 없어요.\n수업과 학습 활동으로 먹이를 모아보세요.';
const ADULT_STAGE = PANDA_GROWTH_THRESHOLDS.length - 1;
const GROWTH_LOCK = `${PANDA_ADULT_LEVEL}단계 성체부터 꾸밀 수 있어요.\n먹이를 주며 랴오랴오를 키워보세요.`;
const ROOM_PENDING = '방 꾸미기는 아직 준비 중이에요.\n조금만 기다려 주세요!';
const GREETING = '냠냠, 오늘도 같이 자라요!';
const REACTIONS = { eating: '냠냠! 맛있게 먹고 있어요.', petting: '쓰다듬어 줘서 고마워요!' };

// Speech has its own lifetime: the shorter mascot motion must not dismiss it.
function usePandaSpeech(action, busy, externallyPaused) {
  const [pageHidden, setPageHidden] = useState(() => document.hidden);
  const [speech, setSpeech] = useState({ visible: false, message: GREETING, kind: 'idle' });
  const entered = useRef(false);
  const lastActionId = useRef(null);
  const paused = externallyPaused || pageHidden;

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const newAction = lastActionId.current !== action.id;
    lastActionId.current = action.id;
    if (paused) {
      // Events while covered or away are consumed, never replayed on return.
      entered.current = true;
      setSpeech(current => current.visible ? { ...current, visible: false } : current);
    } else if (newAction && REACTIONS[action.motion]) {
      entered.current = true;
      setSpeech({ visible: true, message: REACTIONS[action.motion], kind: 'reaction' });
    } else if (!entered.current && !busy) {
      entered.current = true;
      setSpeech({ visible: true, message: GREETING, kind: 'idle' });
    } else if (busy) {
      setSpeech(current => current.visible && current.kind !== 'reaction' ? { ...current, visible: false } : current);
    }
  }, [action.id, action.motion, paused, busy]);

  useEffect(() => {
    if (!speech.visible) return undefined;
    const timer = setTimeout(() => setSpeech(current => ({ ...current, visible: false })), 3000);
    return () => clearTimeout(timer);
  }, [speech]);

  useEffect(() => {
    if (paused || busy || speech.visible) return undefined;
    const timer = setTimeout(() => setSpeech({ visible: true, message: GREETING, kind: 'idle' }), 20000 + Math.random() * 15000);
    return () => clearTimeout(timer);
  }, [paused, busy, speech.visible]);

  return { message: speech.message, visible: speech.visible && !paused };
}

export function validatePandaNickname(value) {
  const original = typeof value === 'string' ? value : '';
  const name = original.normalize('NFC').trim();
  const valid = !/[\u0000-\u001f\u007f-\u009f]/u.test(original)
    && [...name].length >= 1 && [...name].length <= PANDA_NAME_MAX_LENGTH;
  return { name, valid };
}

// Figma 165:7589 / 165:7633 / 165:7677 / 165:7721.
function NameDialog({ open, mode, displayName, onSave, onClose, notice, busy, canTransact, onRetry, returnFocusRef }) {
  const reducedMotion = usePrefersReducedMotion();
  const inputId = useId();
  const { titleRef, ...dialogFocus } = usePandaDialogFocus(returnFocusRef);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const submitting = useRef(false);
  const first = mode === 'first';
  const { name, valid } = validatePandaNickname(draft);
  useEffect(() => {
    if (open) { setDraft(first ? '' : displayName); setSaveError(''); }
  }, [open, first, displayName]);
  const close = () => { if (!saving && !busy) onClose?.(); };
  const save = async event => {
    event.preventDefault();
    if (!valid || saving || busy || !canTransact || submitting.current || !onSave) return;
    submitting.current = true;
    setSaving(true);
    setSaveError('');
    try {
      // Widget closes after the single successful save; dismiss is a separate action.
      if (await onSave(name) !== true) setSaveError('이름을 저장하지 못했어요. 다시 시도해 주세요.');
    } catch { setSaveError('이름을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { submitting.current = false; setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    {(open || !reducedMotion) && <DialogPortal>
      <DialogOverlay className="panda-game-overlay panda-ui-overlay" style={PANDA_GAME_VARS} />
      <DialogSurface className={cn('panda-game-dialog panda-game-name-dialog panda-ui-dialog', first && 'panda-game-name-dialog--first')}
        style={PANDA_GAME_VARS} {...dialogFocus} inert={!open ? '' : undefined}
        onInteractOutside={event => { if (saving || busy) event.preventDefault(); }}
        onEscapeKeyDown={event => { if (saving || busy) event.preventDefault(); }}>
        <div className="panda-game-dialog-intro panda-game-name-intro">
          <DialogTitle ref={titleRef} tabIndex={-1}>{first ? `레벨 ${PANDA_ADULT_LEVEL} 달성!` : '닉네임 수정'}</DialogTitle>
          <DialogDescription>{first ? <>랴오랴오의 이름을 지어주세요.<br />나중에도 자유롭게 바꿀 수 있어요.</> : '랴오랴오를 부를 이름을 바꿔주세요.'}</DialogDescription>
        </div>
        <form onSubmit={save} className="panda-game-name-form">
          <div className="panda-game-name-field">
            <label htmlFor={inputId}>닉네임</label>
            <Input id={inputId} autoComplete="off" value={draft} onChange={event => { setDraft(event.target.value); setSaveError(''); }}
              className={cn('panda-game-input', !draft && 'panda-game-input--empty')} placeholder="닉네임을 입력해 주세요"
              disabled={saving || busy} aria-invalid={draft.length > 0 && !valid} aria-describedby={inputId + '-hint'} />
            <span id={inputId + '-hint'} className={draft.length > 0 && !valid ? 'panda-game-error' : 'sr-only'}
              role={draft.length > 0 && !valid ? 'alert' : undefined}>이름은 줄바꿈 없이 1~{PANDA_NAME_MAX_LENGTH}자로 입력해 주세요.</span>
          </div>
          {(saveError || notice) && <p className="panda-game-error" role="alert">{saveError || notice}</p>}
          {!canTransact && onRetry && <Button variant="outline" className="panda-game-small-button" onClick={onRetry} disabled={saving || busy}>다시 시도</Button>}
          <div className="panda-game-name-actions">
            <Button variant="outline" className="panda-game-button panda-game-button--secondary" onClick={close} disabled={saving || busy}>{first ? '나중에' : '취소'}</Button>
            <Button type="submit" className="panda-game-button panda-game-button--primary" disabled={!valid || saving || busy || !canTransact || !onSave} loading={saving}>
              {saving ? '저장 중' : first ? '이름 짓기' : '저장하기'}
            </Button>
          </div>
        </form>
      </DialogSurface>
    </DialogPortal>}
  </Dialog>;
}

function WardrobeGuideDialog({ open, onClose, onStart, returnFocusRef }) {
  const reducedMotion = usePrefersReducedMotion();
  const { titleRef, ...dialogFocus } = usePandaDialogFocus(returnFocusRef);
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose?.(); }}>
    {(open || !reducedMotion) && <DialogPortal>
      <DialogOverlay className="panda-game-overlay panda-ui-overlay" style={PANDA_GAME_VARS} />
      <DialogSurface className="panda-game-dialog panda-game-wardrobe-guide panda-ui-dialog" style={PANDA_GAME_VARS}
        {...dialogFocus} inert={!open ? '' : undefined}>
        <div className="panda-game-guide-icon" aria-hidden="true"><img src={UI_ASSETS + 'costume.svg'} width="36" height="36" alt="" /></div>
        <div className="panda-game-dialog-intro">
          <DialogTitle ref={titleRef} tabIndex={-1}>이제 꾸밀 수 있어요!</DialogTitle>
          <DialogDescription>모자와 옷, 소품을 골라<br />나만의 랴오랴오로 꾸며보세요.</DialogDescription>
        </div>
        <div className="panda-game-dialog-actions">
          <Button variant="outline" className="panda-game-button panda-game-button--secondary" onClick={onClose}>나중에</Button>
          <Button className="panda-game-button panda-game-button--primary" onClick={onStart}>꾸미러 가기</Button>
        </div>
      </DialogSurface>
    </DialogPortal>}
  </Dialog>;
}

function TransitionDialog({ open, startingFood, onConfirm, onRetry, notice, busy, canTransact, returnFocusRef }) {
  const reducedMotion = usePrefersReducedMotion();
  const { titleRef, ...dialogFocus } = usePandaDialogFocus(returnFocusRef);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const submitting = useRef(false);
  useEffect(() => { if (!open) setSaveError(''); }, [open]);
  const confirm = async () => {
    if (saving || busy || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const result = !canTransact && onRetry ? await onRetry() : await onConfirm?.();
      if (!result) setSaveError('확인 내용을 저장하지 못했어요. 다시 시도해 주세요.');
    } catch { setSaveError('확인 내용을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { submitting.current = false; setSaving(false); }
  };
  return <Dialog open={open}>
    {(open || !reducedMotion) && <DialogPortal>
      <DialogOverlay className="panda-game-overlay panda-ui-overlay" style={PANDA_GAME_VARS} />
      <DialogSurface className="panda-game-dialog panda-game-transition-dialog panda-ui-dialog" style={PANDA_GAME_VARS}
        {...dialogFocus} inert={!open ? '' : undefined}
        onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
        <div className="panda-game-guide-icon" aria-hidden="true"><img src={UI_ASSETS + 'leaf.svg'} width="36" height="36" alt="" /></div>
        <div className="panda-game-dialog-intro">
          <DialogTitle ref={titleRef} tabIndex={-1}>랴오랴오와 새 출발!</DialogTitle>
          <DialogDescription>새로운 랴오랴오는 알부터 시작해요.<br />수업과 숙제 활동으로 얻은 먹이는<br />이미 먹인 것까지 전부 돌려드렸어요.<br /><strong>돌려받은 먹이 {startingFood}개</strong><br />이제 성장 기록은 기기가 바뀌어도 이어져요.</DialogDescription>
        </div>
        {(saveError || notice) && <p className="panda-game-error" role="alert">{notice || saveError}</p>}
        <Button className="panda-game-button panda-game-button--primary" onClick={confirm}
          disabled={saving || busy || (!canTransact && !onRetry)} loading={saving}>
          {saving ? '확인 중' : saveError || notice ? '다시 시도' : '확인하고 시작하기'}
        </Button>
      </DialogSurface>
    </DialogPortal>}
  </Dialog>;
}

export default function PandaGameView({
  stage, stageIdx = 0, levelInfo, fedTotal = 0, available = 0, progress = 0, remaining = 0,
  equipped, nickname, isFeeding = false, isBusy = false, canTransact = true, loading = false, hasProfile = true, error, onRetry,
  canFeed = canTransact && !isBusy && !loading,
  action = { motion: 'idle', id: 0 }, pandaRef, feedBtnRef, feedAllBtnRef, wardrobeTriggerRef,
  onFeed, onPet, onOpenWardrobe, onOpenName,
  namingOpen = false, namingMode = 'edit', onSaveName, onDismissName,
  wardrobeGuideOpen = false, onDismissWardrobeGuide, onStartWardrobeGuide,
  transitionOpen = false, transition, onConfirmTransition,
  notice, fullscreen = false, speechPaused = false,
  growthPulses = [], celebration = null, displayStage = stageIdx,
}) {
  const [toast, setToast] = useState(null);
  const [dismissedError, setDismissedError] = useState(null);
  const [effectHost, setEffectHost] = useState(null);
  const noticeId = useId();
  const nameTriggerRef = useRef(null);
  useEffect(() => {
    setDismissedError(null);
    if (error) setToast({ message: typeof error === 'string' ? error : '기록을 불러오지 못했어요.', error: true });
    else if (notice) setToast({ message: notice, error: false });
    else setToast(null);
  }, [notice, error]);
  useEffect(() => {
    if (!toast || toast.error) return undefined;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  const level = levelInfo || getPandaLevelInfo(fedTotal);
  const celebrating = Boolean(celebration);
  const busy = isFeeding || isBusy || loading || Boolean(celebration);
  const speech = usePandaSpeech(action, busy, !hasProfile || speechPaused || namingOpen || wardrobeGuideOpen || transitionOpen || Boolean(celebration));
  const feedBlocked = !hasProfile || loading || !canFeed || celebrating || transitionOpen;
  const eggGround = displayStage === 0 ? getPandaFigureGroundPoint(160, 0) : null;
  const visibleToast = toast || (error && error !== dismissedError ? { message: typeof error === 'string' ? error : '기록을 불러오지 못했어요.', error: true } : null);
  const title = nickname || (stage?.label || PANDA_STAGE_LABELS[stageIdx]).replace('판다', '랴오랴오');
  const showToast = message => setToast({ message, error: false });
  const feedReason = count => showToast(available === 0 ? NO_FOOD
    : `먹이가 ${count - available}개 부족해요.\n수업과 학습 활동으로 먹이를 모아보세요.`);
  const feedButton = (count, ref, primary) => <div className="panda-game-feed-control">
    <Button ref={ref} variant={primary ? 'default' : 'outline'}
      className={cn('panda-game-button', primary ? 'panda-game-button--primary' : 'panda-game-button--secondary')}
      disabled={feedBlocked || available < count} onClick={() => onFeed?.(count)}
      aria-describedby={available < count && toast ? noticeId : undefined}>먹이주기 x{count}</Button>
    {available < count && !feedBlocked && <button type="button" className="panda-game-lock-hit"
      aria-label={`먹이주기 x${count} 불가 이유 보기`} onClick={() => feedReason(count)} />}
  </div>;

  if (!hasProfile) return <div className={cn('panda-game-view', fullscreen && 'panda-game-view--fullscreen')} style={PANDA_GAME_VARS} aria-busy={loading || undefined}>
    <div className="panda-game-world"><div className="panda-game-stage"><PandaRoomBackdrop /></div></div>
    <section className="panda-game-growth-card" aria-label="성장 기록 확인">
      <h2 className="panda-game-growth-title" style={{ width: '100%', height: 'auto', whiteSpace: 'normal' }}>{loading ? '기록을 불러오는 중이에요' : '기록을 확인하지 못했어요'}</h2>
      <p className="panda-game-error" style={error ? undefined : { color: 'var(--pg-secondary)' }} role={error ? 'alert' : 'status'}>{error || '저장된 성장과 먹이를 확인하고 있어요.'}</p>
      {onRetry && <Button className="panda-game-button panda-game-button--primary" onClick={onRetry} disabled={isBusy || loading}>다시 시도</Button>}
    </section>
  </div>;

  return <div ref={setEffectHost} className={cn('panda-game-view', fullscreen && 'panda-game-view--fullscreen', celebrating && 'panda-game-view--celebrating')} style={PANDA_GAME_VARS} aria-busy={loading || undefined}>
    <div className="panda-game-world">
      <div className="panda-game-stage">
        <PandaRoomBackdrop />
        <div className="panda-game-food" aria-label={`보유 먹이 ${available}개`}>
          <img src={UI_ASSETS + 'leaf.svg'} width="22" height="22" alt="" /><strong>{available}</strong>
        </div>
        <p className={cn('panda-game-speech panda-ui-speech', speech.visible && 'is-visible')} aria-hidden={!speech.visible}
          style={celebration ? { visibility: 'hidden' } : undefined}>{speech.message}</p>
        <img className="panda-game-ground-shadow" src={UI_ASSETS + 'ground-shadow.svg'} width="160" height="18" alt="" />
        <Button variant="ghost" ref={pandaRef} className={cn('panda-game-panda press-static', eggGround && 'panda-game-panda--egg')}
          style={eggGround ? {
            '--panda-egg-bottom-gap': `${160 * 1.36 - eggGround.y}px`,
            transformOrigin: `${eggGround.x}px ${eggGround.y}px`,
          } : undefined} onClick={onPet} disabled={isFeeding || Boolean(celebration) || transitionOpen}
          aria-label={`${title} 쓰다듬기`}>
          <PandaFigure width={160} stage={displayStage} wardrobe={equipped} motion={action.motion} actionId={action.id} decorative
            ambient={!busy && !celebration && !speechPaused && !namingOpen && !wardrobeGuideOpen && !transitionOpen}
            className="panda-game-mascot" />
        </Button>
        <PandaGrowthEffects pulses={growthPulses} celebration={celebration} wardrobe={equipped} portalTarget={effectHost} pandaRef={pandaRef} />
      </div>
      <nav className="panda-game-tools" aria-label="꾸미기 메뉴">
        <Button ref={wardrobeTriggerRef} variant="ghost" className={cn('panda-game-tool', stageIdx < ADULT_STAGE && 'is-locked')}
          aria-description={stageIdx < ADULT_STAGE ? `${PANDA_ADULT_LEVEL}단계 성체부터 꾸밀 수 있어요. 선택하면 잠금 이유를 안내합니다.` : undefined}
          disabled={celebrating || transitionOpen} onClick={() => stageIdx < ADULT_STAGE ? showToast(GROWTH_LOCK) : onOpenWardrobe?.()}>
          <img src={UI_ASSETS + 'costume.svg'} width="20" height="20" alt="" /><span>랴오랴오 꾸미기</span>
        </Button>
        <Button variant="ghost" className="panda-game-tool panda-game-tool--room" disabled={celebrating || transitionOpen} onClick={() => showToast(ROOM_PENDING)}>
          <img src={UI_ASSETS + 'room.svg'} width="20" height="20" alt="" /><span>방 꾸미기</span><small>준비 중</small>
        </Button>
      </nav>
    </div>

    <section className="panda-game-growth-card" aria-label="성장과 먹이주기">
      <h2 className="panda-game-growth-title">레벨{level.level} : {title}</h2>
      {stageIdx === ADULT_STAGE && <Button ref={nameTriggerRef} variant="ghost" size="icon" className="panda-game-name-button" aria-label="닉네임 수정" onClick={onOpenName} disabled={busy || transitionOpen}>
        <img src={UI_ASSETS + 'pencil.svg'} width="22" height="22" alt="" />
      </Button>}
      <div className="panda-game-progress-copy"><span>경험치</span><span>{Math.max(0, fedTotal - level.min)} / {level.nextAt - level.min}</span></div>
      <div className="panda-game-progress" role="progressbar" aria-label={`다음 레벨까지 먹이 ${remaining}개`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, progress))}>
        <span key={level.level} style={{ width: '100%', transform: `scaleX(${Math.min(100, Math.max(0, progress)) / 100})` }} />
      </div>
      {error && <p className="panda-game-error">마지막으로 확인한 성장 기록이에요.</p>}
      <div className={cn('panda-game-feed-actions', available === 0 && 'panda-game-feed-actions--empty')}
        inert={celebrating ? '' : undefined}>
        {feedButton(5, feedAllBtnRef, false)}
        {feedButton(1, feedBtnRef, true)}
      </div>
    </section>

    <PandaUiPresence>{visibleToast && !namingOpen && !wardrobeGuideOpen && !transitionOpen && <div id={noticeId} className="panda-game-toast panda-ui-toast" role={visibleToast.error ? 'alert' : 'status'}>
      <img src={UI_ASSETS + 'toast-info.svg'} width="24" height="24" alt="" />
      <div className="panda-game-toast-copy"><p>{visibleToast.message}</p>
        {visibleToast.error && onRetry && <Button variant="ghost" className="panda-game-toast-retry" onClick={onRetry} disabled={isBusy || loading}>다시 시도</Button>}
      </div>
      <Button type="button" variant="ghost" size="icon" className="panda-toast-close" aria-label="알림 닫기"
        onClick={() => { setDismissedError(error); setToast(null); }}><XIcon size={20} aria-hidden="true" /></Button>
    </div>}</PandaUiPresence>
    <NameDialog open={namingOpen} mode={namingMode} displayName={title} onSave={onSaveName} onClose={onDismissName}
      notice={error} busy={isBusy || loading} canTransact={canTransact} onRetry={error ? onRetry : undefined} returnFocusRef={nameTriggerRef} />
    <WardrobeGuideDialog open={wardrobeGuideOpen} onClose={onDismissWardrobeGuide}
      onStart={onStartWardrobeGuide} returnFocusRef={wardrobeTriggerRef} />
    <TransitionDialog open={transitionOpen} startingFood={transition?.startingFood ?? 0} onConfirm={onConfirmTransition}
      onRetry={onRetry} notice={error} busy={isBusy || loading} canTransact={canTransact} returnFocusRef={feedBtnRef} />
  </div>;
}
