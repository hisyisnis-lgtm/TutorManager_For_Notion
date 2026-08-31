import { Button } from '../shadcn/button';
import { cn } from '@/lib/utils';

/**
 * 파일·녹음 추가 등 섹션 진입 보조 버튼. **중립 면(secondary)** 을 쓴다 —
 * ⛔ 연한 브랜드 면(PRIMARY_BG)으로 채우지 말 것(design_system §18-1).
 * 이건 저장도 제출도 아닌 보조 액션이라, 화면에서 가장 눈에 띌 이유가 없다.
 *
 * 같은 구현이 숙제 상세·숙제 작성·학생앱 숙제 상세 3곳에 복붙돼 있던 것을
 * shadcn Button variant="secondary" 기반으로 통합했다(2026-08-30 검수).
 */
export default function SectionEntryButton({ icon, label, onClick, disabled, className }) {
  return (
    <Button
      type="button"
      variant="secondary"
      block
      onClick={onClick}
      disabled={disabled}
      className={cn('mb-2.5 text-muted-foreground', className)}
    >
      {icon}
      {label}
    </Button>
  );
}
