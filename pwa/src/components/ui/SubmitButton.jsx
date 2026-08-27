import { Button, App } from 'antd';
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
export default function SubmitButton({ blockedReason, loading, onClick, style, children, ...rest }) {
  const { message } = App.useApp();
  const blocked = Boolean(blockedReason) && !loading;

  return (
    <Button
      type="primary"
      block
      size="large"
      loading={loading}
      aria-disabled={blocked || undefined}
      onClick={(e) => {
        if (blocked) {
          // htmlType="submit"이어도 여기서 막는다 — 폼이 그냥 넘어가지 않게.
          e.preventDefault();
          // key를 고정해 연타해도 토스트가 쌓이지 않게 한다(같은 자리에서 문구만 갱신).
          message.warning({ content: blockedReason, key: 'submit-blocked' });
          return;
        }
        onClick?.(e);
      }}
      style={{
        borderRadius: 12,
        fontWeight: 600,
        height: 44,
        // antd의 disabled 모양을 그대로 흉내 낸다 — 사용자 눈엔 똑같이 '못 누르는 버튼'이어야 한다.
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
