"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * shadcn Switch (공식 소스 기반). 상류에서 바꾼 것 — 되돌리지 말 것:
 *  1. transition-colors → transition-[scale,background-color,border-color].
 *     전역 CSS의 press scale(§7.2-bis)을 특이도로 덮지 않기 위함 (button.jsx 4번과 동일).
 *  2. focus ring(ring-2·ring-offset) 제거. 상류의 outline-none도 함께 지웠다 —
 *     전역 :focus-visible 아웃라인(index.css, offset 2px)이 그대로 적용돼
 *     체크 상태(빨간 트랙)에서도 포커스가 보인다(WCAG 2.4.7, Accordion과 동일 패턴).
 */
const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-[scale,background-color,border-color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}>
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )} />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
