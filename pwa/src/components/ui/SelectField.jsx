import { useState } from 'react';
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shadcn/select';
import { cn } from '@/lib/utils';
import { TEXT_TERTIARY } from '../../constants/theme.js';

/**
 * SelectField — antd `<Select options={...} onChange allowClear>` 대체.
 *
 * Radix Select는 조립형(`Trigger/Content/Item`)이라 호출부마다 5줄씩 늘어난다.
 * 15곳이 전부 "옵션 배열 + value + onChange" 한 가지 모양이라 래퍼로 묶는다.
 * (SearchInput과 같은 판단 — 상류 프리미티브는 건드리지 않고 조합만 감싼다.)
 *
 * ⚠️ **Radix는 SelectItem의 value로 빈 문자열을 금지한다** — 내부적으로 "선택 없음"을 뜻해서
 *    빈 문자열을 넘기면 런타임 에러가 난다. 그런데 우리 옵션엔 `{ value: '', label: '전체 기간' }`
 *    같은 항목이 있다(HomeworkFilterBar). 그래서 센티넬로 바꿔 넘기고 돌려받을 때 되돌린다.
 *
 * onChange는 antd와 같이 **값만** 넘긴다(`(v) => ...`) — 호출부를 고칠 필요가 없다.
 *
 * `searchable` — antd `showSearch` 대체(1곳: 숙제 등록의 학생 선택).
 * Radix Select에는 검색이 없어서 목록 위에 필터 입력을 직접 얹는다.
 * 옵션이 적으면 굳이 켜지 말 것 — 입력이 하나 더 생기는 만큼 누를 거리가 늘어난다.
 */
const EMPTY = '__empty__';
const toRadix = (v) => (v === '' ? EMPTY : v === null || v === undefined ? undefined : String(v));
const fromRadix = (v) => (v === EMPTY ? '' : v);

export default function SelectField({
  value,
  onChange,
  options = [],
  placeholder,
  allowClear = false,
  searchable = false,
  searchPlaceholder = '검색',
  disabled,
  className,
  triggerClassName,
  style,
  ...props
}) {
  const [query, setQuery] = useState('');
  const hasValue = value !== undefined && value !== null && value !== '';
  const showClear = allowClear && hasValue && !disabled;
  const visible = searchable && query
    ? options.filter((o) => String(o.label).toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className={cn('relative', className)} style={style}>
      <Select
        value={toRadix(value)}
        onValueChange={(v) => onChange?.(fromRadix(v))}
        disabled={disabled}
        {...props}
      >
        {/* 지우기를 보여줄 땐 캐럿을 숨긴다 — 둘을 나란히 두면 좁은 상자에서 글자를 먹는다.
            antd도 clearable일 때 화살표 자리를 X가 대신했다. */}
        <SelectTrigger className={cn(showClear && 'pr-11 [&>svg:last-child]:hidden', triggerClassName)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {searchable && (
            // Radix는 열린 동안 타이핑을 항목 점프로 가로챈다 → 여기서 전파를 끊어야 입력이 된다.
            <div className="sticky top-0 z-10 mb-1 bg-popover px-1 pt-1">
              <div className="relative">
                <MagnifyingGlassIcon
                  size={16} weight="fill" aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: TEXT_TERTIARY }}
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none"
                />
              </div>
            </div>
          )}
          {visible.length === 0 ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">검색 결과가 없어요</div>
          ) : visible.map((o) => (
            <SelectItem key={String(o.value)} value={toRadix(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showClear && (
        // 히트영역 40 — 44px 상자 안에 들어가야 해서 .hit-40과 같은 근거.
        <button
          type="button"
          aria-label="선택 지우기"
          onClick={() => onChange?.('')}
          className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg"
        >
          <XIcon size={16} weight="bold" style={{ color: TEXT_TERTIARY }} />
        </button>
      )}
    </div>
  );
}
