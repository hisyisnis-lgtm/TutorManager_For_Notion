import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * shadcn Input (공식 소스 기반). 상류에서 바꾼 것 — 되돌리지 말 것:
 *  1. h-10 → h-11(44px). 터치 타겟 규범(WCAG 2.1 AA, button.jsx 5번과 동일).
 *  2. rounded-md → rounded-lg. 우리 기본 radius는 12.
 *  3. 외곽 focus ring(ring-2·ring-offset) 대신 중립 보더와 안쪽 1px 선으로 포커스를 표시한다.
 *     보더 두께·레이아웃을 유지하면서 하나의 2px 테두리로 보강한다(button.jsx 3번과 동일 근거).
 *  4. file: 웨이트 500 유틸 → font-semibold(600). KimjungchulGothic에 500이 없다(§3.3).
 *  5. text-base md:text-sm은 유지할 것 — 모바일에서 16px 미만 입력은 iOS가 포커스 시 자동 줌한다.
 */
const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
