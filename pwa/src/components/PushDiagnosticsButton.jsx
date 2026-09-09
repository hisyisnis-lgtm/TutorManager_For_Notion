import { useEffect, useRef, useState } from 'react';
import { Button } from './shadcn/button';
import { Textarea } from './shadcn/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './shadcn/dialog';
import { collectPushDiagnostics } from '../api/pushDiagnostics.js';

export default function PushDiagnosticsButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const textRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setText('');
    setStatus('이 기기의 알림 상태를 확인하고 있어요.');
    collectPushDiagnostics().then((value) => {
      if (!active) return;
      setText(JSON.stringify(value, null, 2));
      setStatus('진단 내용을 복사해 전달해 주세요.');
    }).catch(() => {
      if (active) setStatus('진단 상태를 읽지 못했어요. 닫았다 다시 시도해 주세요.');
    });
    return () => { active = false; };
  }, [open]);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(text);
      setStatus('복사했어요. 대화창에 붙여넣어 주세요.');
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      setStatus('아래 내용을 길게 눌러 직접 복사해 주세요.');
    }
  };

  return <>
    <Button variant="ghost" block className="mt-2" onClick={() => setOpen(true)}>알림 진단</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>알림 진단</DialogTitle>
          <DialogDescription className="pr-4 leading-relaxed">
            알림 처리 상태만 이 기기에서 확인해요. 알림 내용·이름·로그인 정보는 포함하지 않으며 자동 전송하지 않아요.
          </DialogDescription>
        </DialogHeader>
        <Textarea ref={textRef} aria-label="알림 진단 정보" readOnly value={text} rows={8} className="text-xs font-mono" />
        <p role="status" className="text-sm text-gray-600">{status}</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>닫기</Button>
          <Button disabled={!text} onClick={copy}>진단 내용 복사</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
