import { Link } from 'react-router-dom';
import { Card } from 'antd';
import Badge from '../ui/Badge.jsx';
import { paymentStatusColor, refundSessions, formatSessions } from '../../api/payments.js';
import { formatKRW } from '../../utils/dateUtils.js';
import { stripEmoji } from '../../utils/stringUtils.js';
import { TEXT_PRIMARY, TEXT_TERTIARY, STATUS_ERROR_TEXT } from '../../constants/theme.js';

/**
 * 결제 카드 — PaymentsPage(전체)·StudentPaymentsPage(학생별) 공용.
 * 탭하면 결제 상세(/payments/:id)로 간다.
 *
 * @param {boolean} hideStudentName 학생별 페이지에선 같은 이름이 카드마다 반복되므로
 *                                  수업 종류를 제목 자리로 올린다(ClassCard와 같은 어법).
 */
export default function PaymentCard({ payment, studentNameMap, classTypeMap, hideStudentName = false }) {
  const { bg, text } = paymentStatusColor(payment.paymentStatus);
  const studentName =
    payment.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');
  // 학생 없는 결제(온라인그룹수업 등)는 타이틀(수강생 이름)을 표시
  const displayName = studentName || payment.note || '학생 없음';
  const classTypeName = payment.classTypeId ? classTypeMap[payment.classTypeId]?.title : null;
  const title = hideStudentName ? (classTypeName || displayName) : displayName;

  return (
    <li>
      <Link
        to={`/payments/${payment.id}`}
        className="block tap-wrap"
      >
        <Card
          variant="borderless"
          className="card-tap"
          style={{ borderRadius: 12 }}
          styles={{ body: { padding: '14px 16px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </p>
              {!hideStudentName && classTypeName && (
                <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '2px 0 0' }}>{classTypeName}</p>
              )}
            </div>
            {/* '완료'는 안 그린다 — 결제 98건 중 84건(86%)이 완료라 정보량이 0이다(2026-08-27).
                완료가 아닌 것은 **학생 연결 여부와 무관하게 전부** 띄운다(2026-08-27 사용자 지시).
                노션 formula 네 가지 중 완료를 뺀 나머지: ⚠️초과금 → N원 · 🔴미결제 · 🔴미완료. */}
            {payment.paymentStatus && !payment.paymentStatus.includes('🟢') && (
              <Badge label={stripEmoji(payment.paymentStatus)} bg={bg} text={text} />
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {/* 학생 없는 결제(온라인그룹수업)는 결제 시간·미수금 개념이 없어 실제 결제 금액만 표시 */}
            {payment.studentIds.length > 0 && (
              <div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>결제 시간 </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">{formatSessions(payment.sessionCount)}시간</span>
              </div>
            )}
            <div>
              <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>결제 금액 </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">{formatKRW(payment.studentIds.length ? payment.paymentAmount : payment.actualAmount)}</span>
            </div>
            {payment.studentIds.length > 0 && payment.unpaid > 0 && (
              <div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>미수금 </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: STATUS_ERROR_TEXT }} className="tabular-nums">{formatKRW(payment.unpaid)}</span>
              </div>
            )}
            {payment.refundAmount > 0 && (
              <div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>환불 </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">
                  −{formatKRW(payment.refundAmount)}
                  {payment.studentIds.length > 0 && refundSessions(payment) > 0 && ` · ${formatSessions(refundSessions(payment))}시간`}
                </span>
              </div>
            )}
          </div>
          {payment.paymentDate && (
            <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '8px 0 0' }} className="tabular-nums">결제일 {payment.paymentDate}</p>
          )}
        </Card>
      </Link>
    </li>
  );
}
