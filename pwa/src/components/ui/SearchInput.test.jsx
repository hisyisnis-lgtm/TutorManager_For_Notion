// SearchInput 회귀 테스트 — antd Input(prefix + allowClear) 대체본.
// 핵심 계약: onChange를 antd와 같은 이벤트 모양으로 넘긴다(target.value).
// 호출부들이 전부 e.target.value를 읽으므로 이게 깨지면 검색이 통째로 죽는다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SearchInput from './SearchInput.jsx';

afterEach(cleanup);

describe('SearchInput', () => {
  it('값이 없으면 지우기 버튼을 만들지 않는다', () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.queryByLabelText('검색어 지우기')).toBeNull();
  });

  it('지우기를 누르면 target.value 가 빈 문자열인 객체를 돌려준다', () => {
    const onChange = vi.fn();
    render(<SearchInput value="김" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('검색어 지우기'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe('');
  });

  it('입력하면 이벤트를 그대로 전달한다', () => {
    // 값은 **호출 시점에** 읽어야 한다. 이 입력은 controlled(value="")라서
    // 핸들러가 끝나면 React가 DOM 값을 ''로 되돌린다 — 나중에 event.target을 보면 빈 값이 잡힌다.
    let seen;
    const onChange = vi.fn((e) => { seen = e.target.value; });
    render(<SearchInput value="" onChange={onChange} placeholder="이름으로 검색" />);
    fireEvent.change(screen.getByPlaceholderText('이름으로 검색'), { target: { value: '박' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(seen).toBe('박');
  });
});
