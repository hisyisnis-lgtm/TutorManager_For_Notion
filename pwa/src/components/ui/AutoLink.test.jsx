// AutoLink 회귀 테스트 — 링크화는 강사가 쓴 텍스트를 DOM으로 바꾸는 지점이라
// "무엇을 링크로 만들지 않는가"가 핵심이다. 특히 실행 가능한 스킴 차단은 회귀하면 안 된다.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import AutoLink from './AutoLink.jsx';

afterEach(cleanup);

describe('AutoLink', () => {
  it('http/https 주소를 새 탭 링크로 만든다', () => {
    const { container } = render(<AutoLink text="자료는 https://tiantian-chinese.pages.dev/#/group-class 참고" />);
    const a = container.querySelector('a');
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe('https://tiantian-chinese.pages.dev/#/group-class');
    expect(a.getAttribute('target')).toBe('_blank');
    // opener 노출·탭내빙 방지 — 외부 링크에서 빠지면 안 되는 조합
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toBe('자료는 https://tiantian-chinese.pages.dev/#/group-class 참고');
  });

  it('javascript:·data: 스킴은 링크로 만들지 않는다', () => {
    for (const evil of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
      const { container } = render(<AutoLink text={`여기 ${evil} 클릭`} />);
      expect(container.querySelector('a')).toBeNull();
      cleanup();
    }
  });

  it('문장 끝 마침표는 주소에 포함하지 않는다', () => {
    const { container } = render(<AutoLink text="https://example.com/a. 그리고" />);
    expect(container.querySelector('a').getAttribute('href')).toBe('https://example.com/a');
    expect(container.textContent).toBe('https://example.com/a. 그리고');
  });

  it('주소가 여러 개면 각각 링크가 된다', () => {
    const { container } = render(<AutoLink text="https://a.com 과 https://b.com" />);
    expect(container.querySelectorAll('a')).toHaveLength(2);
  });

  it('URL이 없거나 값이 비어도 안전하게 렌더한다', () => {
    expect(render(<AutoLink text="링크 없는 평범한 피드백이에요" />).container.querySelector('a')).toBeNull();
    cleanup();
    expect(render(<AutoLink text={null} />).container.textContent).toBe('');
    cleanup();
    expect(render(<AutoLink text={undefined} />).container.textContent).toBe('');
  });
});
