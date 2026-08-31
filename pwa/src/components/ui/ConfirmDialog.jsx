import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../shadcn/dialog';
import { Button } from '../shadcn/button';

/**
 * 확인 팝업 — 삭제·되돌릴 수 없는 동작 앞에 세운다. 호출부 12곳.
 *
 * antd Modal → Radix Dialog로 옮기며 지킨 것:
 *  · 이 컴포넌트는 **부모가 조건부로 렌더**한다(열림 상태를 스스로 갖지 않는다).
 *    그래서 Dialog는 항상 open이고, 닫기는 onOpenChange로 부모에게 넘긴다.
 *  · antd Modal은 ESC·마스크 클릭·X 모두 onCancel로 왔다. Radix도 셋 다 onOpenChange(false)다.
 *  · ⚠️ Radix는 DialogTitle이 없으면 접근성 경고를 낸다. title이 안 넘어오는 호출부가 있을 수 있어
 *    기본값을 두고, 설명이 없을 때도 DialogDescription을 비워두지 않는다(aria-describedby 경고 방지).
 */
export default function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  loading = false,
  danger = true,
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !loading) onCancel?.(); }}>
      <DialogContent
        // 취소 버튼이 있는 확인 팝업에 X까지 있으면 닫는 길이 세 개다 — antd Modal.confirm처럼 X 없이
        showClose={false}
        // 로딩 중에는 바깥 클릭·ESC로 닫히지 않게 한다 — 진행 중인 요청을 두고 사라지면 안 된다.
        onPointerDownOutside={(e) => { if (loading) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (loading) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{title || '확인'}</DialogTitle>
          {message
            ? <DialogDescription className="whitespace-pre-line">{message}</DialogDescription>
            : <DialogDescription className="sr-only">이 동작을 진행할까요?</DialogDescription>}
        </DialogHeader>

        <div className="flex gap-3">
          <Button block variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            block
            variant={danger ? 'destructive' : 'default'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
