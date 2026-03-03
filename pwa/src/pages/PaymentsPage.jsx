import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchPaymentsPage, parsePayment, paymentStatusColor } from '../api/payments.js';
import { formatKRW } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';

const STATUS_FILTERS = ['전체', '🟢완료', '🔴미완료', '⬛미결제', '⚠️초과금'];

export default function PaymentsPage() {
  const { students, studentNameMap, classTypeMap } = useData();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [studentFilter, setStudentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);

  const load = useCallback(async (reset = true, nextCursor = null) => {
    if (reset) setLoading(true);
    setError(null);
    try {
      const data = await fetchPaymentsPage({
        studentId: studentFilter || undefined,
        cursor: nextCursor,
      });
      const parsed = data.results.map(parsePayment);
      setPayments((prev) => (reset ? parsed : [...prev, ...parsed]));
      setHasMore(data.has_more);
      setCursor(data.next_cursor);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentFilter]);

  useEffect(() => { load(true); }, [load]);

  const filtered =
    statusFilter === '전체'
      ? payments
      : payments.filter((p) => p.paymentStatus?.startsWith(statusFilter));

  return (
    <>
      <PageHeader
        title="결제 내역"
        action={
          <Link
            to="/payments/new"
            className="flex items-center gap-1 text-sm font-semibold text-brand-600 bg-brand-50 px-3 py-1.5 rounded-lg active:bg-brand-100"
          >
            <span>+</span> 결제 입력
          </Link>
        }
      />

      <div className="px-4 pt-3 pb-2 space-y-2">
        {/* 학생 필터 */}
        <select
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.target.value)}
          className="select-field"
        >
          <option value="">전체 학생</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* 상태 필터 */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === f ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={() => load(true)} />}

      {!loading && !error && (
        <>
          {filtered.length === 0 ? (
            <EmptyState icon="💰" title="결제 내역이 없습니다" />
          ) : (
            <ul className="px-4 space-y-3 pb-4">
              {filtered.map((p) => (
                <PaymentCard
                  key={p.id}
                  payment={p}
                  studentNameMap={studentNameMap}
                  classTypeMap={classTypeMap}
                />
              ))}
            </ul>
          )}
          {hasMore && (
            <div className="px-4 pb-4">
              <button
                onClick={() => load(false, cursor)}
                className="w-full py-3 text-sm font-medium text-gray-500 bg-gray-100 rounded-xl active:bg-gray-200"
              >
                더 보기
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function PaymentCard({ payment, studentNameMap, classTypeMap }) {
  const { bg, text } = paymentStatusColor(payment.paymentStatus);
  const studentName =
    payment.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');
  const classTypeName = payment.classTypeId ? classTypeMap[payment.classTypeId]?.title : null;

  return (
    <li>
      <Link to={`/payments/${payment.id}/edit`} className="card block p-4 active:bg-gray-50">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-gray-900">{studentName || '학생 없음'}</p>
            {classTypeName && (
              <p className="text-xs text-gray-400 mt-0.5">{classTypeName}</p>
            )}
          </div>
          <Badge label={payment.paymentStatus} bg={bg} text={text} />
        </div>
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-xs text-gray-400">시간 회차 </span>
            <span className="font-semibold text-gray-800">{payment.sessionCount}회</span>
          </div>
          <div>
            <span className="text-xs text-gray-400">결제 금액 </span>
            <span className="font-semibold text-gray-800">{formatKRW(payment.paymentAmount)}</span>
          </div>
          {payment.unpaid > 0 && (
            <div>
              <span className="text-xs text-gray-400">미수금 </span>
              <span className="font-semibold text-red-500">{formatKRW(payment.unpaid)}</span>
            </div>
          )}
        </div>
        {payment.paymentDate && (
          <p className="text-xs text-gray-400 mt-2">결제일 {payment.paymentDate}</p>
        )}
      </Link>
    </li>
  );
}
