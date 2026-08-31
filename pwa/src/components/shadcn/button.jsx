import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { CircleNotchIcon } from "@phosphor-icons/react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

/**
 * shadcn Button (공식 소스 기반).
 *
 * 상류에서 바꾼 것은 전부 우리 규범이 요구하는 것뿐이다. 취향으로 더 손대지 말 것 —
 * 상류와 멀어질수록 나중에 원본 변경사항을 반영하기 어려워진다.
 *
 *  1. 웨이트 500 유틸 → semibold(600).
 *     KimjungchulGothic에 500이 없어 시스템 폰트로 폴백한다(design-audit weight-500 규칙, §3.3).
 *     ⚠️ 이 주석에 그 유틸 클래스명을 그대로 적으면 감사가 주석까지 잡는다(§L1191과 같은 함정).
 *  2. `rounded-md` → `rounded-lg`. 우리 기본 radius는 12(= --radius).
 *  3. focus ring 제거(`ring-2`·`ring-offset`). 브랜드색 보더 바깥에 링이 하나 더 생겨
 *     "선이 두 겹"으로 보인다(2026-08-26 → antdTheme.controlOutlineWidth: 0).
 *     대신 **이미 있는 보더의 색을 바꿔** 포커스를 표시한다 — 선이 한 겹으로 끝난다.
 *     ⚠️ 링만 지우고 끝내면 안 된다. 2026-08-28 실측에서 채운 변형은 보더도 transparent라
 *     키보드 포커스 표시가 전혀 없었다(WCAG 2.4.7 위반). 전 변형에 focus-visible 보더색을 준다.
 *  4. transition에 `scale` 포함. 전역 CSS가 `button { transition-property: scale }`로
 *     누름 피드백(§7.2-bis)을 주는데, 유틸 클래스가 특이도로 이겨 그 전환을 덮어쓴다.
 *  5. 크기 44px 기준(§L730·878, WCAG 2.1 AA). 상류 기본 40px는 우리 터치 규범에 미달.
 *  6. 상류의 아이콘 크기 강제(`[&_svg]` 사이즈 유틸) 제거.
 *     상류는 버튼 안 svg를 16px로 **고정**해서, 호출부가 size={20}·size={24}를 줘도
 *     CSS가 HTML 속성을 이겨 전부 16px로 렌더된다(2026-08-28 FAB에서 실측 확인).
 *     우리는 §19.2가 맥락별 크기 토큰(버튼 안=20, 빠른실행/FAB=24)을 정하고
 *     design-audit이 지키므로, Button이 크기를 강제하면 그 규범이 무력화된다.
 *     pointer-events-none·shrink-0은 동작 규약이라 그대로 둔다.
 *  7. `hover:bg-primary/90` → `hover:bg-primary-dark`. 알파를 낮추면 밝은 배경 위에서
 *     오히려 밝아진다. 우리 hover 토큰은 PRIMARY_DARK다.
 *
 * 상류에 없어서 추가한 variant 2개:
 *  - `destructiveOutline` — antd `danger` 단독(흰 배경·빨간 글자/보더) 7곳이 쓰던 조합.
 *    `type="primary" danger` 2곳은 상류 `destructive`가 그대로 대응한다.
 *  - `block` — 전폭 버튼 34곳. 호출부마다 w-full을 적는 대신 variant로 둔다.
 *
 * 상류에 없어서 추가한 prop 1개:
 *  - `loading` — 상류 Button에는 없다(호출부에서 스피너를 직접 넣는 게 shadcn 방식).
 *    다만 antd `loading`을 쓰던 곳이 19곳이라 그때마다 같은 마크업을 반복하게 된다.
 *    넘기지 않으면 상류와 동작이 동일해서 부담 없는 확장이다.
 *    asChild일 때는 스피너를 넣지 않는다 — Slot은 자식이 하나여야 한다.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[scale,background-color,border-color,color] duration-150 ease-out focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-transparent bg-primary text-primary-foreground hover:bg-primary-dark focus-visible:border-primary-foreground",
        destructive:
          "border border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive-foreground",
        destructiveOutline:
          "border border-destructive/40 bg-card text-destructive hover:border-destructive focus-visible:border-destructive",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:border-primary",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:border-primary",
        ghost: "border border-transparent hover:bg-accent hover:text-accent-foreground focus-visible:border-primary",
        link: "border border-transparent text-primary underline-offset-4 hover:underline focus-visible:border-primary",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-10 rounded-lg px-3",
        lg: "h-12 rounded-lg px-8",
        icon: "h-11 w-11",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      block: false,
    },
  }
)

const Button = React.forwardRef((
  { className, variant, size, block, asChild = false, loading = false, disabled, children, ...props },
  ref
) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, block, className }))}
      ref={ref}
      disabled={asChild ? undefined : (disabled || loading)}
      aria-busy={loading || undefined}
      {...props}>
      {asChild ? (
        // Slot은 자식이 정확히 하나여야 한다. `{조건 && ...}{children}`처럼 두 슬롯을 두면
        // 조건이 false여도 React.Children.count가 2로 세어 "Slot failed to slot" 런타임 에러가 난다
        // (2026-08-30 GroupClassPage asChild CTA에서 실측) — asChild면 children만 그대로 넘긴다.
        children
      ) : (
        <>
          {loading && <CircleNotchIcon size={20} weight="bold" className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
