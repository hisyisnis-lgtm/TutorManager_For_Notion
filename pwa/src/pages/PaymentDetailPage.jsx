import {
  useState,
  useEffect } from 'react';
import { useParams,
  Link } from 'react-router-dom';
import { Alert,
  Button,
  Card,
  Input,
  Modal,
  Typography } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import Badge from '../components/ui/Badge.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { getPage } from '../api/notionClient.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import { parsePayment,
  paymentStatusColor,
  updatePayment,
  refundSessions,
  formatSessions,
  isWholeSession } from '../api/payments.js';
import { useData } from '../context/DataContext.jsx';
import { stripEmoji } from '../utils/stringUtils.js';
import { formatKRW,
  todayKST } from '../utils/dateUtils.js';
import { PRIMARY,
  PRIMARY_BG,
  TEXT_SECONDARY,
  TEXT_PRIMARY,
  TEXT_TERTIARY,
  GRAY_100 } from '../constants/theme.js';

function Row({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: `1px solid ${GRAY_100}` }}>
      <span style={{ fontSize: 13, color: TEXT_TERTIARY, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT_PRIMARY, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

export default function PaymentDetailPage() {
  const { id } = useParams();
  const { studentNameMap, classTypeMap } = useData();
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm, setRefundForm] = useState({ amount: '', date: '', reason: '' });
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundError, setRefundError] = useState(null);
  const [refundConfirm, setRefundConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPage(id)
      .then((page) => { if (!cancelled) setP(parsePayment(page)); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <><PageHeader title="결제 상세" back /><LoadingSpinner /></>;
  if (error || !p) return <><PageHeader title="결제 상세" back /><ErrorMessage message={error || '불러올 수 없습니다'} /></>;

  const studentNames = p.studentIds.map((sid) => studentNameMap[sid]).filter(Boolean).join(', ');
  const hasStudent = p.studentIds.length > 0;
  const displayName = studentNames || p.note || '학생 없음';
  const ct = classTypeMap[p.classTypeId];
  const psc = paymentStatusColor(p.paymentStatus);
  const refunded = (p.refundAmount || 0) > 0;
  const netAmount = (p.actualAmount || 0) - (p.refundAmount || 0);
  const fullyRefunded = refunded && netAmount <= 0;

  // 환불 모달 실시간 환산 시간 미리보기 (학생 결제만 — 단가 0이면 0)
  const refundAmtInput = parseFloat(refundForm.amount) || 0;
  const previewSessions = refundSessions({ refundAmount: refundAmtInput, unitPrice: p.unitPrice, discountRate: p.discountRate });

  const openRefund = () => {
    setRefundError(null);
    setRefundForm({
      amount: p.refundAmount ? String(p.refundAmount) : String(p.actualAmount || ''),
      date: p.refundDate || todayKST(),
      reason: p.refundReason || '',
    });
    setRefundOpen(true);
  };

  // 1단계: 검증 후 확인 다이얼로그 표시
  const requestRefund = () => {
    const amt = parseFloat(refundForm.amount);
    if (isNaN(amt) || amt < 0) { setRefundError('환불 금액을 올바르게 입력하세요.'); return; }
    if (amt > (p.actualAmount || 0)) { setRefundError('환불 금액이 실제 결제 금액보다 클 수 없습니다.'); return; }
    setRefundError(null);
    setRefundConfirm(true);
  };

  // 2단계: 확인 후 실제 적용
  const confirmRefund = async () => {
    const amt = parseFloat(refundForm.amount);
    setRefundSaving(true);
    setRefundError(null);
    try {
      await updatePayment(id, {
        refundAmount: amt > 0 ? amt : null,
        refundDate: amt > 0 ? (refundForm.date || todayKST()) : null,
        refundReason: amt > 0 ? refundForm.reason : '',
      });
      const page = await getPage(id);
      setP(parsePayment(page));
      invalidateCache('payment'); // 환불 반영 — 결제 목록·월 매출 요약 stale 방지
      setRefundConfirm(false);
      setRefundOpen(false);
    } catch (e) {
      setRefundConfirm(false);
      setRefundError(e.message);
    } finally {
      setRefundSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="결제 상세" back />
      <div className="px-4 pt-4 pb-24">
        <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: '16px 18px' } }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 18, fontWeight: 700, color: TEXT_PRIMARY, margin: 0 }}>
                {displayName}
              </p>
              {refunded && (
                <span style={{ display: 'inline-block', marginTop: 6 }}>
                  <Badge label={fullyRefunded ? '전액환불' : '부분환불'} bg="bg-amber-100" text="text-amber-700" />
                </span>
              )}
            </div>
            <Link to={`/payments/${id}/edit`} style={{ flexShrink: 0 }}>
              <Button type="text" size="small" style={{ color: PRIMARY, fontWeight: 600, paddingInline: 8 }}>편집</Button>
            </Link>
          </div>
          {hasStudent && <Row label="상태" value={p.paymentStatus ? <Badge label={stripEmoji(p.paymentStatus)} bg={psc.bg} text={psc.text} /> : null} />}
          {hasStudent && <Row label="학생" value={studentNames} />}
          <Row label="수업 종류" value={ct?.title} />
          {hasStudent && <Row label="결제 시간" value={`${formatSessions(p.sessionCount)}시간`} />}
          {hasStudent && <Row label="결제 예정 금액" value={formatKRW(p.paymentAmount)} />}
          <Row label="실제 결제 금액" value={formatKRW(p.actualAmount)} />
          {hasStudent && p.unpaid > 0 && <Row label="미수금" value={formatKRW(p.unpaid)} />}
          {refunded && <Row label="환불 금액" value={`− ${formatKRW(p.refundAmount)}`} />}
          {refunded && hasStudent && refundSessions(p) > 0 && (
            <Row label="환불 시간" value={`− ${formatSessions(refundSessions(p))}시간`} />
          )}
          {refunded && <Row label="환불일" value={p.refundDate} />}
          {refunded && <Row label="환불 사유" value={p.refundReason} />}
          {refunded && <Row label="순 결제 금액" value={formatKRW(netAmount)} />}
          <Row label="결제 수단" value={p.paymentMethod} />
          <Row label="결제일" value={p.paymentDate} />
          {!hasStudent && <Row label="전화번호" value={p.phone} />}
          <Row label="비고" value={hasStudent ? p.note : p.memo} />

          <Button
            block
            onClick={openRefund}
            style={{ marginTop: 16, borderRadius: 12, height: 44, fontWeight: 600 }}
          >
            {refunded ? '환불 내역 수정' : '환불 처리'}
          </Button>
        </Card>
      </div>

      <Modal
        open={refundOpen}
        onCancel={() => setRefundOpen(false)}
        title="환불 처리"
        footer={null}
        centered
        destroyOnHidden
        width="92vw"
        style={{ maxWidth: 420 }}
      >
        {refundError && (
          <Alert type="error" title={refundError} showIcon style={{ borderRadius: 12, marginBottom: 12 }} />
        )}
        <p style={{ fontSize: 13, color: TEXT_TERTIARY, margin: '0 0 14px' }}>
          실제 결제 금액 <strong style={{ color: TEXT_PRIMARY }}>{formatKRW(p.actualAmount)}</strong> 중 환불할 금액을 입력하세요. (0원으로 저장하면 환불 취소)
        </p>

        <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
          환불 금액
        </Typography.Text>
        <Input
          type="number"
          value={refundForm.amount}
          onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))}
          step="1000"
          min="0"
          placeholder="환불할 금액"
          size="large"
          style={{ borderRadius: 12, marginBottom: previewSessions > 0 ? 6 : 12 }}
        />

        {previewSessions > 0 && (
          <div style={{ background: PRIMARY_BG, borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: 0 }}>
              이 금액은 <strong style={{ color: TEXT_PRIMARY }}>{formatSessions(previewSessions)}시간</strong>에 해당해요.
              <span style={{ color: TEXT_TERTIARY }}> 학생 잔여 시간에서 차감됩니다.</span>
            </p>
            {!isWholeSession(previewSessions) && (
              <p style={{ fontSize: 12, color: TEXT_PRIMARY, margin: '4px 0 0', fontWeight: 600 }}>
                ⚠ 시간이 딱 떨어지지 않아요. 금액을 1시간 단위로 맞춰보세요.
              </p>
            )}
          </div>
        )}

        <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
          환불일
        </Typography.Text>
        <Input
          type="date"
          value={refundForm.date}
          onChange={(e) => setRefundForm((f) => ({ ...f, date: e.target.value }))}
          size="large"
          style={{ borderRadius: 12, marginBottom: 12 }}
        />

        <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
          환불 사유 <span style={{ fontWeight: 400, color: TEXT_TERTIARY }}>(선택)</span>
        </Typography.Text>
        <Input
          value={refundForm.reason}
          onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))}
          placeholder="예: 2회 수업 후 중도 환불"
          size="large"
          style={{ borderRadius: 12, marginBottom: 16 }}
        />

        <Button
          type="primary"
          block
          onClick={requestRefund}
          style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
        >
          저장
        </Button>
      </Modal>

      {refundConfirm && (() => {
        const amt = parseFloat(refundForm.amount) || 0;
        return (
          <ConfirmDialog
            title={amt > 0 ? '환불을 처리하시겠습니까?' : '환불을 취소하시겠습니까?'}
            message={amt > 0
              ? `${formatKRW(amt)}을 환불 처리합니다.\n매출(이번 달 수입·추이)에서 환불액이 차감됩니다.`
              : '이 결제의 환불 내역을 지웁니다.'}
            confirmLabel={amt > 0 ? '환불 처리' : '환불 취소'}
            cancelLabel="취소"
            danger={false}
            onConfirm={confirmRefund}
            onCancel={() => setRefundConfirm(false)}
            loading={refundSaving}
          />
        );
      })()}
    </>
  );
}
