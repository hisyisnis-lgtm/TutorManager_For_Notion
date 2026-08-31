"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * shadcn Dialog (공식 소스 기반). 상류에서 바꾼 것 — 되돌리지 말 것:
 *  1. `sm:rounded-lg` → `rounded-2xl`. 상류는 **모바일(<640px)에서 radius 0**이라
 *     화면 폭을 꽉 채우는 시트처럼 보인다. 우리 모달은 antd 때부터 항상 16이었다.
 *  2. 오버레이 `bg-black/80` → `bg-black/45`. antd 마스크가 45%였다 — 80%는 훨씬 어둡다.
 *  3. `shadow-lg` → `shadow-[shadow:var(--shadow-modal)]`. 그림자 토큰이 이미 있다(§6.4).
 *  4. `border` 제거. 우리 표면은 보더가 아니라 그림자로 경계를 낸다.
 *  5. 폭 `w-full` → `w-[calc(100%-2rem)]`. 375px 화면에서 좌우가 화면에 붙었다.
 *  6. 닫기 버튼 sr-only 문구를 한국어로.
 *  7. 닫기 버튼의 focus:outline-none 제거 — 전역 :focus-visible 아웃라인(index.css)이
 *     적용돼 키보드 포커스가 보인다(WCAG 2.4.7). transition에 scale 포함(전역 press scale 유지).
 *  8. DialogHeader `text-center sm:text-left` → `text-left`. 모바일 원컬럼 앱이라 sm 분기가
 *     의미 없고, 상류 기본대로 두면 모바일에서 제목만 가운데·본문은 왼쪽으로 갈라진다
 *     (2026-08-31 로그아웃 다이얼로그에서 지적 — ConfirmDialog·수입 상세·환불 3곳 동일 증상).
 */

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// 상류에 없어서 추가한 prop: `showClose`.
// antd Modal의 `closable={false}`를 쓰던 화면이 있다(FileAttachModal — 업로드 중 이탈 방지로
// X·마스크·ESC를 전부 막는다). 상류 DialogContent는 X를 **항상** 그려서 그 화면을 옮길 수 없다.
// 기본값 true라 넘기지 않으면 상류와 동작이 같다.
const DialogContent = React.forwardRef(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-2xl bg-background p-6 shadow-[shadow:var(--shadow-modal)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
      {...props}>
      {children}
      {showClose && (
        <DialogPrimitive.Close
          aria-label="닫기"
          className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-lg opacity-70 transition-[opacity,scale] hover:opacity-100 disabled:pointer-events-none">
          <XIcon weight="bold" className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
