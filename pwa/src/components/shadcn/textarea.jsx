import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * shadcn Textarea (공식 소스 기반).
 *
 * 상류에 없어서 추가한 prop 2개 — antd `Input.TextArea`를 쓰던 화면을 옮기려면 필요했다.
 * 둘 다 넘기지 않으면 상류와 동작이 같다.
 *
 *  · `autoSize={{ minRows, maxRows }}` — 내용에 따라 높이가 자란다(2곳: 공지 작성·수업 특이사항).
 *    maxRows를 넘으면 스크롤로 전환한다.
 *  · `showCount` — `maxLength`와 함께 "현재/최대" 글자수를 아래에 보여준다(2곳).
 *    ⚠️ showCount를 쓰면 textarea가 래퍼 div 안으로 들어간다. 부모가 flex로 높이를 잡고 있으면 확인할 것.
 */
const Textarea = React.forwardRef(({ className, autoSize, showCount, maxLength, value, ...props }, ref) => {
  const innerRef = React.useRef(null);
  const setRefs = React.useCallback((node) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const minRows = autoSize?.minRows ?? 2;
  const maxRows = autoSize?.maxRows ?? 12;

  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || !autoSize) return;
    const cs = window.getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const min = minRows * lh + pad + border;
    const max = maxRows * lh + pad + border;
    // 먼저 auto로 되돌려야 줄어들 때도 scrollHeight가 제대로 잡힌다.
    el.style.height = 'auto';
    const wanted = el.scrollHeight + border;
    el.style.height = Math.min(Math.max(wanted, min), max) + 'px';
    el.style.overflowY = wanted > max ? 'auto' : 'hidden';
  }, [value, autoSize, minRows, maxRows]);

  const field = (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={setRefs}
      value={value}
      maxLength={maxLength}
      rows={autoSize ? minRows : props.rows}
      {...props} />
  );

  if (!showCount) return field;

  return (
    <div className="relative">
      {field}
      <span className="mt-1 block text-right text-xs text-muted-foreground tabular-nums">
        {String(value ?? '').length}{maxLength ? ' / ' + maxLength : ''}
      </span>
    </div>
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
