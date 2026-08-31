import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

/**
 * shadcn Alert (공식 소스 기반).
 *
 * 상류엔 default·destructive 둘뿐인데, antd Alert를 쓰던 화면이 warning·success도 쓴다.
 * 색은 theme.js의 STATUS_* 토큰을 그대로 옮긴 CSS 변수를 쓴다(새 색을 만들지 않는다).
 * 또 상류 destructive는 **글자·보더만** 칠하고 면은 비운다 — antd는 면까지 칠했으므로
 * 눈에 띄는 정도를 맞추려고 배경 토큰을 함께 준다.
 */

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive-border bg-destructive-bg text-destructive [&>svg]:text-destructive",
        warning:
          "border-warning-border bg-warning-bg text-warning [&>svg]:text-warning",
        success:
          "border-success-border bg-success-bg text-success [&>svg]:text-success",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props} />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-semibold leading-none tracking-tight", className)}
    {...props} />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props} />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
