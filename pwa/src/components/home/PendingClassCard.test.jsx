// 수업 마무리 카드 — 앱 숙제는 VIP 전용(2026-09-04)이라 비VIP 수업엔 숙제 버튼을 내지 않는다.
// 이전엔 버튼이 떠서 눌러도 출제 폼에서 막히는 막다른 길이었다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PendingClassCard from './PendingClassCard.jsx';

vi.mock('../../api/lessonLogs.js', () => ({ createLessonLog: vi.fn(), fetchLogsByClassIds: vi.fn(async () => ({})) }));
vi.mock('../../hooks/useCachedResource.js', () => ({ invalidateCache: vi.fn() }));

afterEach(cleanup);

const cls = {
  id: 'c1',
  datetime: '2026-09-04T10:00:00+09:00',
  endTime: '2026-09-04T11:00:00+09:00',
  studentIds: ['s1'],
  lessonLogIds: [],
  title: '테스트',
};

function mount(props) {
  return render(
    <MemoryRouter>
      <PendingClassCard cls={cls} studentName="홍길동" hwDone={false} {...props} />
    </MemoryRouter>,
  );
}

describe('PendingClassCard — 숙제 버튼 노출', () => {
  it('VIP 학생(hwRequired 기본값)에는 숙제 부여 버튼과 일지 작성 버튼이 모두 있다', () => {
    mount({});
    expect(screen.getByRole('button', { name: '숙제 부여' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '일지 작성' })).toBeTruthy();
  });

  it('비VIP(hwRequired=false)에는 숙제 버튼이 없고 일지 버튼만 남는다', () => {
    mount({ hwRequired: false });
    expect(screen.queryByRole('button', { name: /숙제 부여/ })).toBeNull();
    expect(screen.getByRole('button', { name: '일지 작성' })).toBeTruthy();
  });

  it('숙제 부여 완료 상태는 비활성 완료 버튼으로 표시된다', () => {
    mount({ hwDone: true });
    const btn = screen.getByRole('button', { name: /숙제 부여 완료/ });
    expect(btn.disabled).toBe(true);
  });
});
