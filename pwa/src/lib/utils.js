import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn 표준 클래스 병합 유틸.
 *
 * twMerge가 반드시 필요하다 — 단순 join으로는 Tailwind 클래스 충돌이 해소되지 않는다.
 * 예) cn('px-2', 'px-4') → join이면 "px-2 px-4"(뒤가 이기는지 CSS 순서에 의존),
 *     twMerge면 "px-4"로 확정된다. variant 위에 className으로 덮어쓰는 패턴이
 *     예측 가능하게 동작하려면 이 함수가 정확해야 한다.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
