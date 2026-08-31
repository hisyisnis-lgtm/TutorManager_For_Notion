// SelectField 회귀 테스트 — antd Select를 Radix로 갈아끼우며 생긴 두 가지 함정을 고정한다.
//  1) Radix는 SelectItem의 value로 빈 문자열을 금지한다(런타임 에러). 우리 옵션엔 빈 문자열 항목이 있다.
//  2) onChange는 antd처럼 "값만" 넘겨야 한다 — 호출부들이 그 시그니처를 쓴다.
// 이 경로는 화면으로 확인할 수 없다: 유일한 호출부(ArchiveTab)가 pillMode라 Select 분기가 렌더되지 않는다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SelectField from './SelectField.jsx';

afterEach(cleanup);

const OPTIONS = [
  { value: '', label: '전체 기간' },
  { value: '2026-08', label: '2026년 8월' },
];

describe('SelectField', () => {
  it('빈 문자열 value 옵션이 있어도 렌더가 깨지지 않는다 (Radix 제약 회피)', () => {
    expect(() => render(<SelectField value="" onChange={() => {}} options={OPTIONS} />)).not.toThrow();
  });

  it('선택된 값이 빈 문자열이면 그 옵션의 라벨을 보여준다', () => {
    render(<SelectField value="" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('combobox').textContent).toContain('전체 기간');
  });

  it('값이 있을 때만 지우기 버튼이 보이고, 누르면 빈 문자열을 돌려준다', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SelectField value="" onChange={onChange} options={OPTIONS} allowClear />);
    expect(screen.queryByLabelText('선택 지우기')).toBeNull();

    rerender(<SelectField value="2026-08" onChange={onChange} options={OPTIONS} allowClear />);
    fireEvent.click(screen.getByLabelText('선택 지우기'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('allowClear가 없으면 값이 있어도 지우기 버튼을 만들지 않는다', () => {
    render(<SelectField value="2026-08" onChange={() => {}} options={OPTIONS} />);
    expect(screen.queryByLabelText('선택 지우기')).toBeNull();
  });
});
