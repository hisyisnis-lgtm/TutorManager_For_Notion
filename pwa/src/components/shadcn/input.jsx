import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * shadcn Input (공식 소스 기반). 상류에서 바꾼 것 — 되돌리지 말 것:
 *  1. h-10 → h-11(44px). 터치 타겟 규범(WCAG 2.1 AA, button.jsx 5번과 동일).
 *  2. rounded-md → rounded-lg. 우리 기본 radius는 12.
 *  3. focus ring(ring-2·ring-offset) 제거 → focus-visible:border-primary.
 *     이미 있는 보더의 색을 바꿔 포커스를 표시한다(button.jsx 3번과 동일 근거).
 *  4. file: 웨이트 500 유틸 → font-semibold(600). KimjungchulGothic에 500이 없다(§3.3).
 *  5. text-base md:text-sm은 유지할 것 — 모바일에서 16px 미만 입력은 iOS가 포커스 시 자동 줌한다.
 */
const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
