import { Button } from '../shadcn/button';

/**
 * 목록 하단 '더 보기' — 목록을 늘리는 보조 동작이라 중립 면(secondary)으로 튀지 않는다.
 * 같은 8줄 인라인 버튼이 수업·수업 일지·결제·학생앱 숙제 4개 페이지에 복붙돼 있던 것을
 * shadcn Button variant="secondary" 기반으로 통합했다(2026-08-30 검수).
 */
export default function LoadMoreButton({ onClick, loading = false }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      block
      onClick={onClick}
      disabled={loading}
      className="text-muted-foreground"
      style={{ fontSize: 13 }}
    >
      {loading ? '불러오는 중…' : '더 보기'}
    </Button>
  );
}
