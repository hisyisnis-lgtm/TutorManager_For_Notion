import { Select } from 'antd';
import { CheckIcon } from '@phosphor-icons/react';
import { TEXT_SECONDARY } from '../../constants/theme.js';

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

/**
 * 데이터에서 선택 가능한 연도를 뽑는다. 'YYYY-MM-DD…' 문자열 배열을 받는다.
 * 오름차순 — 범위의 시작/끝 기본값이 각각 첫 해·마지막 해가 된다.
 */
export function yearsOf(isoDates) {
  return [...new Set(isoDates.map((d) => d?.slice(0, 4)).filter(Boolean))].sort();
}

/**
 * 범위 상태(`{ sy, sm, ey, em }`)를 실제 비교값으로 푼다.
 * - 값을 안 건드렸으면 **데이터 전 구간**이라 기본이 곧 '전체'다(별도 적용/해제 버튼이 필요 없는 이유).
 * - 시작이 끝보다 뒤면 자동으로 뒤집는다 — 고르는 순서 때문에 빈 화면이 나오지 않게.
 * - 'YYYY-MM'은 월이 0으로 채워져 있어 문자열 비교만으로 대소가 맞다.
 */
export function resolveMonthRange(range, years) {
  const sy = years.includes(range.sy) ? range.sy : (years[0] ?? '');
  const ey = years.includes(range.ey) ? range.ey : (years[years.length - 1] ?? '');
  const sm = range.sm || '01';
  const em = range.em || '12';
  const [from, to] = [`${sy}-${sm}`, `${ey}-${em}`].sort();
  return { sy, sm, ey, em, from, to };
}

/** 위에서 푼 범위로 목록을 거른다. 연도 선택지가 없으면(=데이터 없음) 그대로 반환. */
export function filterByMonthRange(items, getDate, range, years) {
  if (!years.length) return items;
  const { from, to } = resolveMonthRange(range, years);
  return items.filter((it) => {
    const k = getDate(it)?.slice(0, 7);
    return k && k >= from && k <= to;
  });
}

/**
 * "2026 년 [3] ~ [8] 월" 날짜 범위 필터 — 학생별 수업·결제 목록 공용.
 *
 * 작은 상자 + 바깥 단위 라벨로 두는 이유: 탭(반반 2개) 아래에 같은 폭 상자를 또 놓으면
 * 세로로 뭉쳐 보인다(2026-08-26). **한 해 안의 범위면 종료쪽 년 상자를 생략**해
 * "2026년 1월 ~ 12월"로 짧게 — 360px에서도 한 줄에 들어간다.
 * (연도 선택지가 여러 개여도 마찬가지다 — 년 상자 2개를 같이 놓으면 375px에서 글자가 잘린다.
 *  해를 넘겨 고르는 순간 종료쪽 년 상자가 나타나므로 못 고르게 되는 건 아니다. 2026-08-27 수업 캘린더.)
 */
export default function MonthRangeFilter({ years, value, onChange }) {
  if (!years.length) return null;
  const { sy, sm, ey, em } = resolveMonthRange(value, years);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
      <YearMonth
        year={sy} month={sm} years={years} hideMonthUnit
        onYear={(v) => onChange({ ...value, sy: v })}
        onMonth={(v) => onChange({ ...value, sm: v })}
      />
      <span style={{ color: TEXT_SECONDARY, fontSize: 13, userSelect: 'none', flexShrink: 0, padding: '0 6px' }}>~</span>
      <YearMonth
        year={ey} month={em} years={years} hideYear={ey === sy}
        onYear={(v) => onChange({ ...value, ey: v })}
        onMonth={(v) => onChange({ ...value, em: v })}
      />
    </div>
  );
}

/** 범위의 한쪽 — [년 ▾] 년 [월 ▾] 월. 단위를 상자 밖에 두면 상자가 작아져 탭과 리듬이 겹치지 않는다. */
function YearMonth({ year, month, years, onYear, onMonth, hideYear = false, hideMonthUnit = false }) {
  // 단위는 앞 상자에 속한 글자다. 양쪽 간격이 같으면 '년'이 어느 상자 것인지 모호해진다.
  const unit = { fontSize: 13, color: TEXT_SECONDARY, userSelect: 'none', flexShrink: 0 };
  const unitBetween = { ...unit, marginRight: 10 };
  // showSearch를 끄는 이유: antd v6 단일 Select는 열면 검색 입력으로 바뀌어 고른 값이 흐려진다.
  const common = {
    showSearch: false,
    menuItemSelectedIcon: <CheckIcon size={16} weight="bold" />,
    styles: { popup: { root: { borderRadius: 12 } } },
  };

  // display:contents — 이 래퍼를 flex 계산에서 빼야 두 월 상자 폭이 같아진다.
  return (
    <span style={{ display: 'contents' }}>
      {!hideYear && (
        <>
          <Select
            {...common}
            value={year}
            onChange={onYear}
            options={years.map((y) => ({ value: y, label: y }))}
            style={{ flex: 1.4, minWidth: 0 }}
          />
          <span style={unitBetween}>년</span>
        </>
      )}
      <Select
        {...common}
        value={month}
        onChange={onMonth}
        options={MONTHS.map((m) => ({ value: m, label: String(Number(m)) }))}
        style={{ flex: 1, minWidth: 0 }}
      />
      {/* 시작쪽 '월'은 생략 — "1 ~ 12월"이 자연스럽고, 끝의 '월'이 양쪽을 함께 받는다 */}
      {!hideMonthUnit && <span style={unit}>월</span>}
    </span>
  );
}
