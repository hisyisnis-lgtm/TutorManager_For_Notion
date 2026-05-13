import { Modal, Button, Flex } from 'antd';
import { TEXT_SECONDARY } from '../../constants/theme.js';

export default function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  loading = false,
  danger = true,
}) {
  return (
    <Modal
      open
      title={title}
      onCancel={onCancel}
      footer={null}
      centered
      styles={{ content: { borderRadius: 16 } }}
    >
      {message && (
        <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: '8px 0 24px', whiteSpace: 'pre-line' }}>{message}</p>
      )}
      <Flex gap={12}>
        <Button
          block
          size="large"
          onClick={onCancel}
          disabled={loading}
          style={{ borderRadius: 12 }}
        >
          {cancelLabel}
        </Button>
        <Button
          block
          danger={danger}
          type="primary"
          size="large"
          onClick={onConfirm}
          loading={loading}
          style={{ borderRadius: 12 }}
        >
          {confirmLabel}
        </Button>
      </Flex>
    </Modal>
  );
}
