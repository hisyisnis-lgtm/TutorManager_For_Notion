import { Button } from '../shadcn/button';
import { toast } from 'sonner';
import { GRAY_100, GRAY_300, TEXT_DISABLED } from '../../constants/theme.js';

/**
 * 폼 제출 버튼 — 등록·저장·수정 화면 공용.
 *
 * 아직 채울 게 남았으면 **비활성처럼 보이되 눌리게** 둔다.
 * 진짜 `disabled`를 걸면 클릭 이벤트 자체가 안 와서 "왜 안 눌리지"로 끝나고,
 * 무엇이 비었는지 알려줄 기회도 사라진다. 그래서 눌리면 토스트로 말해준다.
 * (`aria-disabled`라 스크린리더에도 '비활성'으로 읽히고, 포커스는 유지된다.)
 *
 * @param blockedReason 채워야 할 게 남았을 때의 안내 문구. 없으면(`null`) 정상 제출.
 */
export default function SubmitButton({ blockedReason, loading, onClick, style, children, htmlType, type, ...rest }) {
  const blocked = Boolean(blockedReason) && !loading;
  // antd는 `htmlType`을 네이티브 `type`으로 번역해줬다. 우리 Button은 native button이라
  // 그대로 넘기면 DOM에 알 수 없는 속성으로 새어나간다(React 경고).
  // 호출부 4곳이 아직 htmlType을 쓰므로 여기서 받아 번역한다.
  const nativeType = type ?? htmlType ?? 'button';

  return (
    <Button
      block
      type={nativeType}
      loading={loading}
      aria-disabled={blocked || undefined}
      onClick={(e) => {
        if (blocked) {
          // htmlType="submit"이어도 여기서 막는다 — 폼이 그냥 넘어가지 않게.
          e.preventDefault();
          // key를 고정해 연타해도 토스트가 쌓이지 않게 한다(같은 자리에서 문구만 갱신).
          toast.warning(blockedReason, { id: 'submit-blocked' });
          return;
        }
        onClick?.(e);
      }}
      style={{
        // radius 12·weight 600·height 44는 우리 Button 기본값이라 뺐다.
        // blocked 모양만 남긴다 — 우리 Button의 disabled(opacity 50%)와 생김새가 달라서,
        // "못 누르는 버튼"으로 읽히게 하려면 이 면·보더 조합이 필요하다.
        ...(blocked
          ? { background: GRAY_100, color: TEXT_DISABLED, border: `1px solid ${GRAY_300}`, boxShadow: 'none' }
          : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Button>
  );
}
