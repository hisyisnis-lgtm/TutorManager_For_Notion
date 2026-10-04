import { Content as DialogSurface } from '@radix-ui/react-dialog';
import { CaretRightIcon, XIcon } from '@phosphor-icons/react';
import { Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '../shadcn/dialog.jsx';
import { Button } from '../shadcn/button.jsx';
import { BG_APP, PRIMARY_BG, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY } from '../../constants/theme.js';
import usePandaDialogFocus from '../../hooks/usePandaDialogFocus.js';
import PandaFigure from './PandaFigure.jsx';

export default function PandaUpdateNotice({ open, onDismiss, onVisit }) {
  const { titleRef, ...focus } = usePandaDialogFocus();
  // 다음 안내가 열릴 때 닫힘 애니메이션이 겹치지 않도록 즉시 언마운트한다.
  if (!open) return null;

  return (
    <Dialog open onOpenChange={next => { if (!next) onDismiss(); }}>
      <DialogPortal>
        {/* 학생앱의 하단 내비게이션(z-200)까지 가리는 안내 레이어. */}
        <DialogOverlay className="z-[210]" />
        <DialogSurface
          {...focus}
          className="fixed left-1/2 top-1/2 z-[220] grid -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-lg bg-background p-6 shadow-[shadow:var(--shadow-modal)]"
          style={{
            width: 'min(400px, calc(100% - 32px - env(safe-area-inset-left) - env(safe-area-inset-right)))',
            maxHeight: 'calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
            color: TEXT_PRIMARY,
          }}
        >
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="absolute right-2 top-2" aria-label="업데이트 안내 닫기">
              <XIcon size={20} weight="bold" aria-hidden />
            </Button>
          </DialogClose>
          <DialogTitle ref={titleRef} tabIndex={-1} className="pr-7 text-xl leading-snug break-keep" style={{ outline: 'none' }}>
            랴오랴오 키우기가<br />새로워졌어요!
          </DialogTitle>
          <div aria-hidden="true" className="flex items-center justify-center gap-5 rounded-lg py-2" style={{ background: BG_APP }}>
            <PandaFigure width={56} stage={0} decorative />
            <CaretRightIcon size={20} style={{ color: TEXT_TERTIARY }} />
            <PandaFigure width={84} stage={5} decorative />
          </div>
          <DialogDescription className="text-sm leading-relaxed break-keep" style={{ color: TEXT_SECONDARY }}>
            수업과 숙제로 모은 먹이로 랴오랴오를 키워 보세요.
            다 자라면 나만의 모습으로 꾸밀 수 있어요.
          </DialogDescription>
          <p className="m-0 rounded-lg p-3 text-sm leading-relaxed break-keep" style={{ background: PRIMARY_BG }}>
            새로운 랴오랴오는 알부터 시작해요.<br />
            지금까지 모은 먹이는 모두 다시 드려요.
          </p>
          <div className="grid gap-2">
            <Button block onClick={onVisit}>랴오랴오 만나러 가기</Button>
            <Button block variant="ghost" onClick={onDismiss}>나중에</Button>
          </div>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
