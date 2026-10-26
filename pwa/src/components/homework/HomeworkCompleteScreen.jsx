import { useEffect, useRef } from 'react';
import { CaretLeftIcon, CheckIcon } from '@phosphor-icons/react';
import { Button } from '../shadcn/button';
import { ABOVE_BOTTOM_NAV } from '../../constants/styles.js';
import { BG_APP } from '../../constants/theme.js';
import './HomeworkCompleteScreen.css';

export default function HomeworkCompleteScreen({ title, name, onConfirm }) {
  const headingRef = useRef(null);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="homework-done" style={{ background: BG_APP }}>
      <header className="h-14 shrink-0">
        <div className="mx-auto flex h-full max-w-[480px] items-center px-4">
          <Button variant="ghost" size="icon" onClick={onConfirm}
            className="-ml-2 text-muted-foreground" aria-label="뒤로가기">
            <CaretLeftIcon size={20} weight="bold" aria-hidden />
          </Button>
        </div>
      </header>
      <div className="homework-done-body" style={{ paddingBottom: `calc(${ABOVE_BOTTOM_NAV} + 72px)` }}>
        <div className="w-full max-w-[448px] text-center">
          <div className="homework-done-icon text-foreground" aria-hidden>
            <span className="homework-done-disc bg-muted" />
            <CheckIcon className="homework-done-check" size={44} weight="bold" />
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="homework-done-title text-foreground">{title}</h1>
          <p className="homework-done-name text-muted-foreground">{name}</p>
        </div>
      </div>
      <div className="homework-done-actions" style={{ bottom: ABOVE_BOTTOM_NAV, background: BG_APP }}>
        <div className="mx-auto max-w-[448px]">
          <Button block size="lg" onClick={onConfirm}>확인</Button>
        </div>
      </div>
    </div>
  );
}
