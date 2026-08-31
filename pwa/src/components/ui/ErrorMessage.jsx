import { WarningCircleIcon } from '@phosphor-icons/react';
import { Alert, AlertTitle, AlertDescription } from '../shadcn/alert';
import { Button } from '../shadcn/button';

export default function ErrorMessage({ message, onRetry }) {
  return (
    <div style={{ margin: '16px 20px 0' }}>
      <Alert variant="destructive">
        <WarningCircleIcon size={16} weight="fill" aria-hidden />
        <AlertTitle>오류가 발생했습니다</AlertTitle>
        <AlertDescription>
          <span>{message}</span>
          {onRetry && (
            <>
              {' '}
              <Button variant="link" size="sm" onClick={onRetry} className="h-auto p-0 align-baseline text-destructive">
                다시 시도
              </Button>
            </>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}
