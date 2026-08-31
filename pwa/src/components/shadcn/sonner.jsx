"use client";
import {
  CheckCircleIcon,
  InfoIcon,
  CircleNotchIcon,
  XCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Toaster as Sonner } from "sonner"

// next-themes를 쓰지 않는다 — 이 앱은 라이트 전용이라 다크 팔레트 자체가 없다.
// 상류 기본값 theme="system"을 두면 OS가 다크인 사용자에게만 토스트가 검게 떠서
// 나머지 화면과 어긋난다. 값을 고정하는 게 맞다.
const Toaster = ({
  ...props
}) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CheckCircleIcon weight="fill" className="h-4 w-4" />,
        info: <InfoIcon weight="fill" className="h-4 w-4" />,
        warning: <WarningIcon weight="fill" className="h-4 w-4" />,
        error: <XCircleIcon weight="fill" className="h-4 w-4" />,
        loading: <CircleNotchIcon weight="bold" className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster }
