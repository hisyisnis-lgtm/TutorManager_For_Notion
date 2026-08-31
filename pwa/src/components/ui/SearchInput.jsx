import { MagnifyingGlassIcon, XCircleIcon } from '@phosphor-icons/react';
import { Input } from '../shadcn/input';
import { cn } from '@/lib/utils';
import { TEXT_TERTIARY } from '../../constants/theme.js';

/**
 * SearchInput — antd `<Input prefix={검색아이콘} allowClear>` 대체.
 *
 * shadcn Input에 범용 `prefix`·`allowClear`를 넣지 않고 이 컴포넌트로 묶은 이유:
 * 코드베이스의 prefix 7곳이 **전부 같은 검색 아이콘**이고, Input의 allowClear 9곳도
 * 전부 그 검색 필드였다. 범용 옵션을 만들 근거가 없다(YAGNI).
 * (Select의 allowClear 2곳은 별개 — 그건 Select 쪽에서 다룬다.)
 *
 * onChange는 antd와 같은 이벤트 형태로 넘긴다 — 호출부가 전부 `e.target.value`를 읽는다.
 * 지우기 버튼도 같은 모양의 객체를 보내 호출부를 고칠 필요가 없게 했다.
 */
export default function SearchInput({ value, onChange, placeholder = '검색', className, inputClassName, ...props }) {
  const hasValue = value !== undefined && value !== null && value !== '';
  return (
    <div className={cn('relative', className)}>
      <MagnifyingGlassIcon
        size={16} weight="fill" aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
        style={{ color: TEXT_TERTIARY }}
      />
      <Input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn('pl-9', hasValue && 'pr-11', inputClassName)}
        {...props}
      />
      {hasValue && (
        // 히트영역 40px — 44px 입력 안에 들어가야 해서 .hit-40과 같은 근거로 40을 쓴다.
        <button
          type="button"
          aria-label="검색어 지우기"
          onClick={() => onChange?.({ target: { value: '' } })}
          className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg"
        >
          <XCircleIcon size={16} weight="fill" style={{ color: TEXT_TERTIARY }} />
        </button>
      )}
    </div>
  );
}
