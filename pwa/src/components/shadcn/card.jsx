import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * shadcn Card (공식 소스 기반).
 *
 * 상류에서 바꾼 것:
 *  1. Card에서 border·shadow-sm 제거 → shadow-[shadow:var(--shadow-border)].
 *     우리 카드는 3겹 투명 레이어 그림자로 경계를 낸다(§6.4). 실사용 33곳이 전부 borderless였다.
 *  2. CardContent 기본 패딩 p-6 pt-0 → px-4 py-3.5 (= 16px 14px).
 *     상류의 pt-0은 **위에 CardHeader가 있다는 전제**라, 헤더 없이 쓰는 우리 카드에선
 *     내용이 위쪽에 붙어버린다. 24px 패딩도 모바일 카드엔 과하다.
 *     실사용 최빈값이 antd styles={{body:{padding:'14px 16px'}}}였다.
 *     ⚠️ `npx shadcn@latest add card --overwrite`를 다시 돌리면 이 두 가지가 되돌아간다.
 *        재실행 후 반드시 여기를 다시 확인할 것 (2026-08-28에 실제로 겪었다 — 카드 패딩이
 *        14/16 → 24로 벌어지고 위쪽이 붙어버렸는데 빌드·테스트는 전부 통과했다).
 */

const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-lg bg-card text-card-foreground shadow-[shadow:var(--shadow-border)]", className)}
    {...props} />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
    {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-4 py-3.5", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props} />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
