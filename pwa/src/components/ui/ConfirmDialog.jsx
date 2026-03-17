import { Modal, Button, Flex } from 'antd';

export default function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = '삭제',
  loading = false,
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
        <p style={{ fontSize: 14, color: '#595959', margin: '8px 0 24px' }}>{message}</p>
      )}
      <Flex gap={12}>
        <Button
          block
          size="large"
          onClick={onCancel}
          disabled={loading}
          style={{ borderRadius: 12 }}
        >
          취소
        </Button>
        <Button
          block
          danger
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
