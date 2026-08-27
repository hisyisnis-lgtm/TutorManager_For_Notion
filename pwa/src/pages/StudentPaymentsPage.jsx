import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { CurrencyDollarIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import PaymentCard from '../components/payments/PaymentCard.jsx';
import MonthRangeFilter, { yearsOf, filterByMonthRange } from '../components/ui/MonthRangeFilter.jsx';
import { getPage } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';
import { fetchAllPayments, parsePayment, formatSessions } from '../api/payments.js';
import { formatKRW, formatManwon } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';
import { TEXT_PRIMARY, TEXT_TERTIARY, STATUS_ERROR_TEXT, BORDER_NEUTRAL, GRAY_200 } from '../constants/theme.js';

/**
 * 학생별 결제 내역 — 학생 상세의 '결제 정보 › 자세히'로 진입.
 * 상세에는 최근 5건만 접어 두고, 전체 이력과 합계는 여기서 본다(수업의 StudentClassesPage와 같은 자리).
 */
export default function StudentPaymentsPage() {
  const { id } = useParams();
  const { studentNameMap, classTypeMap } = useData();

  const [student, setStudent] = useState(null);
  const [payments, setPayments] = useState([]);
  // 결제일 기준 범위 필터. 값을 안 건드리면 데이터 전 구간 = 전체.
  const [range, setRange] = useState({ sy: '', sm: '', ey: '', em: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [studentPage, rows] = await Promise.all([
        getPage(id),
        fetchAllPayments(id),
      ]);
      setStudent(parseStudent(studentPage));
      setPayments(rows.map(parsePayment));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <><PageHeader title="결제" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="결제" back /><ErrorMessage message={error} onRetry={load} /></>;

  const years = yearsOf(payments.map((p) => p.paymentDate));
  const list = filterByMonthRange(payments, (p) => p.paymentDate, range, years);

  // 합계는 **화면에 보이는 목록 그대로** 더한다 — 필터를 걸면 그 기간의 합계가 된다.
  // 결제 시간은 환불 차감분(유효 시간 회차)이 아니라 '결제한 시간' 원값 — 이력 화면이라 있는 그대로.
  const totalAmount = list.reduce((sum, p) => sum + (p.studentIds.length ? p.paymentAmount : p.actualAmount), 0);
  const totalHours = list.reduce((sum, p) => sum + (p.sessionCount ?? 0), 0);
  const totalUnpaid = list.reduce((sum, p) => sum + (p.unpaid ?? 0), 0);

  return (
    <>
      <PageHeader title={`${student?.name ?? ''} 결제`} back />

      {payments.length === 0 ? (
        <EmptyState
          icon={<CurrencyDollarIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
          title="결제 내역이 없어요"
        />
      ) : (
        <>
          {years.length > 0 && (
            <div className="px-4 pt-4">
              <MonthRangeFilter years={years} value={range} onChange={setRange} />
            </div>
          )}

          {/* 합계 — 이력을 훑기 전에 "얼마를 냈고 못 받은 게 있나"를 먼저 */}
          <div className="px-4 pt-3">
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 12, background: '#fff',
                boxShadow: 'var(--shadow-border)',
              }}
            >
              <Total label="결제 건수" value={`${list.length}건`} />
              <Divider />
              <Total label="결제 시간" value={`${formatSessions(totalHours)}시간`} />
              <Divider />
              {/* 세 칸을 나눠 쓰는 자리라 원 단위면 잘린다 — 만원 단위로(2026-08-27) */}
              <Total label="결제 금액" value={formatManwon(totalAmount)} />
            </div>
            {totalUnpaid > 0 && (
              <p className="tabular-nums" style={{ fontSize: 13, fontWeight: 600, color: STATUS_ERROR_TEXT, margin: '8px 0 0' }}>
                미수금 {formatKRW(totalUnpaid)}
              </p>
            )}
          </div>

          <ul className="px-4 pt-4 space-y-3 pb-24">
            {list.map((p) => (
              <PaymentCard
                key={p.id}
                payment={p}
                studentNameMap={studentNameMap}
                classTypeMap={classTypeMap}
                hideStudentName
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Total({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: 11, color: TEXT_TERTIARY, margin: '0 0 2px' }}>{label}</p>
      <p className="tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </p>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, alignSelf: 'stretch', background: GRAY_200, flexShrink: 0 }} aria-hidden="true" />;
}
