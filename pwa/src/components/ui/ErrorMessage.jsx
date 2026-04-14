import { Alert, Button } from 'antd';

export default function ErrorMessage({ message, onRetry }) {
  return (
    <div style={{ margin: '24px 16px 0' }}>
      <Alert
        type="error"
        title="오류가 발생했습니다"
        description={
          <>
            <span>{message}</span>
            {onRetry && (
              <>
                {' '}
                <Button type="link" size="small" onClick={onRetry} style={{ padding: 0 }}>
                  다시 시도
                </Button>
              </>
            )}
          </>
        }
        showIcon
        style={{ borderRadius: 12 }}
      />
    </div>
  );
}
